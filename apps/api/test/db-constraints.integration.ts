import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const prisma = new PrismaClient()
const apiRoot = resolve(__dirname, '..')

function runTsx(scriptPath: string, extraEnv: Record<string, string> = {}) {
  return execFileSync('pnpm', ['exec', 'tsx', scriptPath], {
    cwd: apiRoot,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
}

async function cleanDatabase() {
  await prisma.checkoutIdempotencyKey.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.orderEvent.deleteMany()
  await prisma.reservation.deleteMany()
  await prisma.stockMovement.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.address.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.batch.deleteMany()
  await prisma.variant.deleteMany()
  await prisma.productImage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.coupon.deleteMany()
  await prisma.pickupLocation.deleteMany()
  await prisma.serviceablePincode.deleteMany()
  await prisma.setting.deleteMany()
  await prisma.admin.deleteMany()
}

describe('PostgreSQL schema, constraints, and seeds (integration)', () => {
  beforeAll(async () => {
    await prisma.$connect()
    await cleanDatabase()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('bootstrap:prod creates owner admin and default settings with ZERO products', async () => {
    runTsx('prisma/bootstrap.prod.ts', {
      BOOTSTRAP_ADMIN_EMAIL: 'owner@pressedoils.test',
    })

    const productCount = await prisma.product.count()
    const admin = await prisma.admin.findUnique({ where: { email: 'owner@pressedoils.test' } })
    const settingsCount = await prisma.setting.count()

    expect(productCount).toBe(0)
    expect(admin).not.toBeNull()
    expect(admin?.role).toBe('OWNER')
    expect(admin?.password_hash).toBeNull()
    expect(admin?.must_set_password).toBe(true)
    expect(settingsCount).toBeGreaterThanOrEqual(4)
  })

  it('seed:dev is repeatable (running twice yields exact 6 products, 18 variants, 6 batches, 18 initial stock movements)', async () => {
    await cleanDatabase()

    runTsx('prisma/seed.dev.ts', { NODE_ENV: 'development', APP_ENV: 'development' })
    runTsx('prisma/seed.dev.ts', { NODE_ENV: 'development', APP_ENV: 'development' })

    const [products, variants, batches, images, stockMovements] = await Promise.all([
      prisma.product.count(),
      prisma.variant.count(),
      prisma.batch.count(),
      prisma.productImage.count(),
      prisma.stockMovement.count(),
    ])

    expect(products).toBe(6)
    expect(variants).toBe(18)
    expect(batches).toBe(6)
    expect(images).toBe(6)
    expect(stockMovements).toBe(18)
  })

  it('enforces one current batch per product via partial unique index', async () => {
    const product = await prisma.product.findFirstOrThrow()

    await expect(
      prisma.batch.create({
        data: {
          product_id: product.id,
          batch_no: 'SECOND-CURRENT-SHOULD-FAIL',
          pressed_on: new Date('2026-02-01'),
          best_before: new Date('2026-11-01'),
          is_current: true,
          is_active: true,
        },
      }),
    ).rejects.toThrow()

    // Non-current historical or future batch is allowed
    const secondary = await prisma.batch.create({
      data: {
        product_id: product.id,
        batch_no: 'NEXT-NOT-CURRENT',
        pressed_on: new Date('2026-02-02'),
        best_before: new Date('2026-11-02'),
        is_current: false,
        is_active: true,
      },
    })
    expect(secondary.is_current).toBe(false)
    await prisma.batch.delete({ where: { id: secondary.id } })
  })

  it('enforces ON DELETE RESTRICT on batches referenced by order_items', async () => {
    const product = await prisma.product.findFirstOrThrow({
      include: { variants: true, batches: true },
    })
    const variant = product.variants[0]!
    const batch = product.batches[0]!

    const customer = await prisma.customer.create({
      data: { name: 'Test Buyer', phone: '+919876543210' },
    })

    const order = await prisma.order.create({
      data: {
        order_number: 'ORD-TEST-0001',
        customer_id: customer.id,
        address_snapshot: { city: 'Chennai', pincode: '600001' },
        subtotal_paise: variant.price_paise,
        shipping_paise: 0,
        total_paise: variant.price_paise,
        payment_method: 'ONLINE',
        items: {
          create: {
            variant_id: variant.id,
            batch_id: batch.id,
            product_name_snapshot: product.name,
            size_snapshot: variant.size_label,
            qty: 1,
            unit_price_paise: variant.price_paise,
          },
        },
      },
    })

    // Deleting a batch referenced by an order item must fail due to ON DELETE RESTRICT
    await expect(prisma.batch.delete({ where: { id: batch.id } })).rejects.toThrow()

    // Marking it inactive instead succeeds
    const inactivated = await prisma.batch.update({
      where: { id: batch.id },
      data: { is_active: false },
    })
    expect(inactivated.is_active).toBe(false)

    // Restore for subsequent checks
    await prisma.batch.update({ where: { id: batch.id }, data: { is_active: true } })
    await prisma.order.delete({ where: { id: order.id } })
    await prisma.customer.delete({ where: { id: customer.id } })
  })

  it('enforces reserved <= stock CHECK constraint and non-negative order/payment constraints at database level', async () => {
    const variant = await prisma.variant.findFirstOrThrow()

    await expect(
      prisma.variant.update({
        where: { id: variant.id },
        data: { reserved: variant.stock + 1 },
      }),
    ).rejects.toThrow()

    const customer = await prisma.customer.create({
      data: { name: 'Constraint Check', phone: '+919876543299' },
    })

    await expect(
      prisma.order.create({
        data: {
          order_number: 'ORD-CHK-NEG',
          customer_id: customer.id,
          address_snapshot: {},
          subtotal_paise: 1000,
          shipping_paise: 0,
          cod_fee_paise: -1,
          total_paise: 1000,
          payment_method: 'COD',
        },
      }),
    ).rejects.toThrow()

    await prisma.customer.delete({ where: { id: customer.id } })
  })

  it('check:no-placeholders fails when active seeded placeholder products exist, and passes when clean', async () => {
    expect(() => runTsx('scripts/check-no-placeholders.ts')).toThrow()

    await cleanDatabase()
    runTsx('prisma/bootstrap.prod.ts', {
      BOOTSTRAP_ADMIN_EMAIL: 'owner@pressedoils.test',
    })
    expect(() => runTsx('scripts/check-no-placeholders.ts')).not.toThrow()

    // Re-seed dev data so local DB ends ready for development
    await cleanDatabase()
    runTsx('prisma/seed.dev.ts', { NODE_ENV: 'development', APP_ENV: 'development' })
  })
})
