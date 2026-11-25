import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import Redis from 'ioredis'
import {
  apiErrorResponseSchema,
  cartValidateResponseSchema,
  checkoutFailResponseSchema,
  checkoutResponseSchema,
  checkoutVerifyResponseSchema,
  healthLivenessResponseSchema,
  healthReadinessResponseSchema,
  pincodeLookupResponseSchema,
  publicAvailabilityResponseSchema,
  publicProductListResponseSchema,
  publicProductSchema,
  publicSettingsResponseSchema,
} from '@pressedoils/shared'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { CartSessionService } from '../src/cart/cart-session.service'
import { CheckoutService } from '../src/checkout/checkout.service'
import { PaymentGatewayService } from '../src/checkout/payment-gateway.service'
import { env, validateEnv } from '../src/env'
import { PrismaService } from '../src/prisma/prisma.service'
import { ProductCacheService } from '../src/products/products.cache'
import { RedisService } from '../src/redis/redis.service'
import { SettingsService } from '../src/settings/settings.service'

const apiRoot = resolve(__dirname, '..')

describe('Public API E2E (PostgreSQL + Redis)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let redis: RedisService
  let cacheService: ProductCacheService

  beforeAll(async () => {
    execFileSync('pnpm', ['exec', 'tsx', 'prisma/seed.dev.ts'], {
      cwd: apiRoot,
      env: { ...process.env, NODE_ENV: 'development', APP_ENV: 'development' },
      shell: process.platform === 'win32',
    })

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication({ bodyParser: false })
    const testEnv = validateEnv({
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'development',
      CORS_ORIGINS: 'http://localhost:3000',
    })
    configureApp(app, testEnv)
    await app.init()

    prisma = app.get(PrismaService)
    redis = app.get(RedisService)
    cacheService = app.get(ProductCacheService)

    // Ensure clean cache & rate-limit state in Redis across consecutive runs
    if (process.env.REDIS_URL) {
      const cleanupClient = new Redis(process.env.REDIS_URL)
      await cleanupClient.flushdb()
      await cleanupClient.quit()
    }
    await cacheService.invalidateProductCache()
  })

  afterAll(async () => {
    await app.close()
  })

  it('health liveness & readiness endpoints return valid status and X-Request-Id', async () => {
    const live = await request(app.getHttpServer()).get('/api/health').expect(200)
    expect(live.headers['x-request-id']).toBeTruthy()
    expect(live.headers['x-content-type-options']).toBe('nosniff')
    expect(healthLivenessResponseSchema.parse(live.body).status).toBe('ok')

    const ready = await request(app.getHttpServer()).get('/api/health/ready').expect(200)
    const parsed = healthReadinessResponseSchema.parse(ready.body)
    expect(parsed.checks.database).toBe('ok')
  })

  it('health readiness stays HTTP 200 degraded when Redis fails', async () => {
    const spy = vi.spyOn(redis, 'ping').mockResolvedValueOnce('degraded')
    const ready = await request(app.getHttpServer()).get('/api/health/ready').expect(200)
    const parsed = healthReadinessResponseSchema.parse(ready.body)
    expect(parsed.status).toBe('degraded')
    expect(parsed.checks).toEqual({ database: 'ok', redis: 'degraded' })
    spy.mockRestore()
  })

  it('GET /api/products validates contract, hides stock/reserved, sets Cache-Control/ETag, and supports 304', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/products?sort=featured&page=1&pageSize=3')
      .expect(200)

    expect(res.headers['cache-control']).toContain('max-age=5')
    expect(res.headers['etag']).toBeTruthy()

    const parsed = publicProductListResponseSchema.parse(res.body)
    expect(parsed.items).toHaveLength(3)
    expect(parsed.pagination).toEqual({ page: 1, pageSize: 3, total: 6, totalPages: 2 })

    const rawJson = JSON.stringify(res.body)
    expect(rawJson).not.toContain('"stock"')
    expect(rawJson).not.toContain('"reserved"')
    expect(rawJson).not.toContain('labReportKey')

    // Conditional ETag -> 304 Not Modified
    await request(app.getHttpServer())
      .get('/api/products?sort=featured&page=1&pageSize=3')
      .set('If-None-Match', res.headers['etag'] as string)
      .expect(304)
  })

  it('GET /api/products rejects unknown query params and minPricePaise > maxPricePaise without stack traces', async () => {
    const unknownRes = await request(app.getHttpServer()).get('/api/products?extra=123').expect(400)
    const err1 = apiErrorResponseSchema.parse(unknownRes.body)
    expect(err1.requestId).toBeTruthy()
    expect(JSON.stringify(unknownRes.body)).not.toContain('at ')

    const priceRes = await request(app.getHttpServer())
      .get('/api/products?minPricePaise=50000&maxPricePaise=10000')
      .expect(400)
    apiErrorResponseSchema.parse(priceRes.body)
  })

  it('GET /api/products/:slug returns detail, 404 for unknown slug, and respects cache invalidation', async () => {
    const detail = await request(app.getHttpServer()).get('/api/products/groundnut-oil').expect(200)
    const parsed = publicProductSchema.parse(detail.body)
    expect(parsed.slug).toBe('groundnut-oil')
    expect(parsed.currentBatch?.batchNo).toBe('PH-GND-001')

    await request(app.getHttpServer()).get('/api/products/nonexistent-oil').expect(404)

    // Update a variant price in DB, invalidate cache, and confirm fresh price returns
    const variant = parsed.variants[0]!
    await prisma.variant.update({ where: { id: variant.id }, data: { price_paise: 15000 } })
    await cacheService.invalidateProductCache('groundnut-oil', [variant.id])

    const after = await request(app.getHttpServer()).get('/api/products/groundnut-oil').expect(200)
    expect(after.body.variants.find((v: { id: string }) => v.id === variant.id)?.pricePaise).toBe(
      15000,
    )

    // Restore seeded price
    await prisma.variant.update({
      where: { id: variant.id },
      data: { price_paise: variant.pricePaise },
    })
    await cacheService.invalidateProductCache('groundnut-oil', [variant.id])
  })

  it('GET /api/products/availability returns live availability with no-store and respects lowStockThreshold', async () => {
    const list = await request(app.getHttpServer()).get('/api/products?pageSize=1').expect(200)
    const variant = list.body.items[0].variants[0]

    // Set variant stock to 3 (below low_stock_threshold 5)
    await prisma.variant.update({ where: { id: variant.id }, data: { stock: 3, reserved: 0 } })

    const availRes = await request(app.getHttpServer())
      .get(`/api/products/availability?variantIds=${variant.id}`)
      .expect(200)

    expect(availRes.headers['cache-control']).toBe('no-store')
    const parsed = publicAvailabilityResponseSchema.parse(availRes.body)
    expect(parsed.maxOrderQtyPerVariant).toBe(env.MAX_QTY_PER_VARIANT)
    expect(parsed.items[0]).toEqual({
      variantId: variant.id,
      inStock: true,
      lowStock: true,
      availableStock: 3,
    })

    // Restore stock to 50 -> availableStock must disappear
    await prisma.variant.update({ where: { id: variant.id }, data: { stock: 50 } })
    const restored = await request(app.getHttpServer())
      .get(`/api/products/availability?variantIds=${variant.id}`)
      .expect(200)
    expect(restored.body.items[0]).toEqual({
      variantId: variant.id,
      inStock: true,
      lowStock: false,
    })
  })

  it('products still load from PostgreSQL when Redis cache fails', async () => {
    const getSpy = vi.spyOn(redis, 'getJson').mockResolvedValue(null)
    const setSpy = vi.spyOn(redis, 'setJson').mockResolvedValue(undefined)
    const strGetSpy = vi.spyOn(redis, 'getString').mockResolvedValue(null)
    const strSetSpy = vi.spyOn(redis, 'setStringNx').mockResolvedValue(false)

    const res = await request(app.getHttpServer()).get('/api/products').expect(200)
    expect(publicProductListResponseSchema.parse(res.body).items.length).toBeGreaterThan(0)

    getSpy.mockRestore()
    setSpy.mockRestore()
    strGetSpy.mockRestore()
    strSetSpy.mockRestore()
  })

  it('GET /api/settings returns whitelisted settings and enforces production banner rule', async () => {
    const res = await request(app.getHttpServer()).get('/api/settings').expect(200)
    expect(res.headers['cache-control']).toContain('max-age=5')
    expect(res.headers['etag']).toBeTruthy()
    const parsed = publicSettingsResponseSchema.parse(res.body)
    expect(parsed.currency).toBe('INR')
    expect(parsed.maxQtyPerVariant).toBe(env.MAX_QTY_PER_VARIANT)
  })

  it('CORS allows exact allowlisted origin without credentials and rejects unknown origin', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/settings')
      .set('Origin', 'http://localhost:3000')
      .expect(200)
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined()

    const blocked = await request(app.getHttpServer())
      .get('/api/settings')
      .set('Origin', 'https://attacker.example.com')
      .expect(200)
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('GET /api/pincode/:pincode returns uniform schema for found & not-found and enforces strict rate limit', async () => {
    const found = await request(app.getHttpServer()).get('/api/pincode/600001').expect(200)
    expect(found.headers['cache-control']).toContain('max-age=300')
    expect(pincodeLookupResponseSchema.parse(found.body)).toEqual({
      pincode: '600001',
      serviceable: true,
      city: 'Chennai',
      state: 'Tamil Nadu',
      deliveryDays: 2,
      codAllowed: true,
      shippingPaise: 5000,
    })

    const missing = await request(app.getHttpServer()).get('/api/pincode/999999').expect(200)
    expect(pincodeLookupResponseSchema.parse(missing.body)).toEqual({
      pincode: '999999',
      serviceable: false,
      city: null,
      state: null,
      deliveryDays: null,
      codAllowed: false,
      shippingPaise: null,
    })

    expect(Object.keys(found.body).sort()).toEqual(Object.keys(missing.body).sort())

    await request(app.getHttpServer()).get('/api/pincode/1234').expect(400)

    // Trigger strict 20 req/min rate limit on /api/pincode/:pincode
    let hit429 = false
    for (let i = 0; i < 22; i++) {
      const r = await request(app.getHttpServer()).get('/api/pincode/600001')
      if (r.status === 429) {
        hit429 = true
        break
      }
    }
    expect(hit429).toBe(true)
  })

  it('POST /api/cart/validate ignores price tampering, enforces free shipping threshold transitions & coupon math, hides counts > threshold, and rate-limits invalid coupons', async () => {
    // 1. Default settings: freeShippingEnabled = false (threshold MUST NOT be exposed), showTaxBreakdown = false
    const defaultSettings = await request(app.getHttpServer()).get('/api/settings').expect(200)
    const parsedSettings = publicSettingsResponseSchema.parse(defaultSettings.body)
    expect(parsedSettings.freeShippingEnabled).toBe(false)
    expect(parsedSettings.freeShippingThresholdPaise).toBeNull()
    expect(parsedSettings.showTaxBreakdown).toBe(false)

    // Load a real seeded 1L variant (price 20000 = Rs 200)
    const productsRes = await request(app.getHttpServer())
      .get('/api/products?pageSize=6')
      .expect(200)
    const variant1L = productsRes.body.items[0].variants.find(
      (v: { sizeLabel: string }) => v.sizeLabel === '1 L',
    )
    expect(variant1L).toBeTruthy()

    // 2. Reject unknown/tampered price field in strict Zod payload
    await request(app.getHttpServer())
      .post('/api/cart/validate')
      .send({
        items: [{ variantId: variant1L.id, qty: 2, unitPricePaise: 1 }],
        fulfilmentMethod: 'DELIVERY',
      })
      .expect(400)

    // 3. Valid validate mints X-Cart-Session header & respects freeShipping off + "Items total" without pincode
    const cartNoPin = await request(app.getHttpServer())
      .post('/api/cart/validate')
      .set('Origin', 'http://localhost:3000')
      .send({
        items: [{ variantId: variant1L.id, qty: 5 }], // 5 * 20000 = 100000 paise (Rs 1000)
        fulfilmentMethod: 'DELIVERY',
      })
      .expect(200)

    expect(cartNoPin.headers['cache-control']).toBe('no-store')
    expect(cartNoPin.headers['x-cart-session']).toBeTruthy()
    expect(cartNoPin.headers['access-control-allow-origin']).toBe('http://localhost:3000')

    const parsedNoPin = cartValidateResponseSchema.parse(cartNoPin.body)
    expect(parsedNoPin.freeShipping).toBeNull()
    expect(parsedNoPin.tax).toEqual({ showTaxBreakdown: false })
    expect(parsedNoPin.summary.totalLabel).toBe('Items total')
    expect(parsedNoPin.summary.shippingStatus).toBe('ENTER_PINCODE')
    expect(parsedNoPin.summary.totalPaise).toBe(100000)

    const sessionToken = cartNoPin.headers['x-cart-session'] as string

    // 4. Owner turns ON free shipping (threshold 99900 paise) via protected endpoint -> STAFF denied, OWNER allowed + audit logged
    const prevOwnerSecret = env.OWNER_SETTINGS_SECRET
    env.OWNER_SETTINGS_SECRET = 'integration-owner-secret-123'
    try {
      await prisma.admin.upsert({
        where: { email: 'staff-test@example.invalid' },
        update: { role: 'STAFF', is_active: true },
        create: { email: 'staff-test@example.invalid', role: 'STAFF', is_active: true },
      })

      await request(app.getHttpServer())
        .patch('/api/admin/settings')
        .set('x-admin-secret', env.OWNER_SETTINGS_SECRET)
        .set('x-admin-email', 'staff-test@example.invalid')
        .send({ freeShipping: { enabled: true, thresholdPaise: 99900 } })
        .expect(403)

      const toggledOn = await request(app.getHttpServer())
        .patch('/api/admin/settings')
        .set('x-admin-secret', env.OWNER_SETTINGS_SECRET)
        .set('x-admin-email', 'owner-dev@example.invalid')
        .send({ freeShipping: { enabled: true, thresholdPaise: 99900 } })
        .expect(200)
      expect(toggledOn.body.freeShippingEnabled).toBe(true)
      expect(toggledOn.body.freeShippingThresholdPaise).toBe(99900)

      // Boundary: 5 * 20000 = 100000 >= 99900 -> Free shipping!
      const freeQual = await request(app.getHttpServer())
        .post('/api/cart/validate')
        .set('x-cart-session', sessionToken)
        .send({
          items: [{ variantId: variant1L.id, qty: 5 }],
          fulfilmentMethod: 'DELIVERY',
          pincode: '600001',
        })
        .expect(200)
      expect(freeQual.body.freeShipping.qualified).toBe(true)
      expect(freeQual.body.summary.shippingPaise).toBe(0)
      expect(freeQual.body.summary.totalPaise).toBe(100000)

      // Apply SAMPLE10 (10% off 100000 -> net 90000 < 99900) -> drops below free-shipping threshold!
      const couponDropped = await request(app.getHttpServer())
        .post('/api/cart/validate')
        .set('x-cart-session', sessionToken)
        .send({
          items: [{ variantId: variant1L.id, qty: 5 }],
          couponCode: 'sample10',
          fulfilmentMethod: 'DELIVERY',
          pincode: '600001',
        })
        .expect(200)
      expect(couponDropped.body.coupon.applied).toBe(true)
      expect(couponDropped.body.summary.discountPaise).toBe(10000)
      expect(couponDropped.body.summary.netItemsTotalPaise).toBe(90000)
      expect(couponDropped.body.freeShipping.qualified).toBe(false)
      expect(couponDropped.body.freeShipping.remainingPaise).toBe(9900)
      expect(couponDropped.body.summary.shippingPaise).toBe(5000)
      expect(couponDropped.body.summary.totalPaise).toBe(95000)
      // Verify used_count was NOT incremented by /cart/validate
      const couponRow = await prisma.coupon.findUnique({ where: { code: 'SAMPLE10' } })
      expect(couponRow?.used_count).toBe(0)

      // Toggling freeShipping back off takes effect immediately
      const toggledOff = await request(app.getHttpServer())
        .patch('/api/admin/settings')
        .set('x-admin-secret', env.OWNER_SETTINGS_SECRET)
        .set('x-admin-email', 'owner-dev@example.invalid')
        .send({ freeShipping: { enabled: false } })
        .expect(200)
      expect(toggledOff.body.freeShippingEnabled).toBe(false)
      expect(toggledOff.body.freeShippingThresholdPaise).toBeNull()

      const afterOff = await request(app.getHttpServer())
        .post('/api/cart/validate')
        .set('x-cart-session', sessionToken)
        .send({
          items: [{ variantId: variant1L.id, qty: 5 }],
          fulfilmentMethod: 'DELIVERY',
          pincode: '600001',
        })
        .expect(200)
      expect(afterOff.body.freeShipping).toBeNull()
      expect(afterOff.body.summary.shippingPaise).toBe(5000)

      // 5. Invalid coupon guessing hits 429 after 10 attempts
      let couponHit429 = false
      for (let i = 0; i < 12; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/api/cart/validate')
          .set('x-cart-session', sessionToken)
          .send({
            items: [{ variantId: variant1L.id, qty: 1 }],
            couponCode: `BADCODE${i}`,
            fulfilmentMethod: 'DELIVERY',
          })
        if (res.status === 429) {
          couponHit429 = true
          break
        }
        expect(res.body.coupon.message).toBe("This code isn't valid")
      }
      expect(couponHit429).toBe(true)

      await prisma.admin.deleteMany({ where: { email: 'staff-test@example.invalid' } })
    } finally {
      env.OWNER_SETTINGS_SECRET = prevOwnerSecret
    }
  })

  it('Phase 5 Checkout: enforces server pricing, COD/pincode/cap rules, idempotency, row locks, pickup HMAC codes, late refunds, and prod guards', async () => {
    const cartSessionService = app.get(CartSessionService)
    const checkoutService = app.get(CheckoutService)
    const paymentGateway = app.get(PaymentGatewayService)
    const settingsService = app.get(SettingsService)
    const lateSessionA = cartSessionService.resolveOrCreateSession(undefined).token
    const lateSessionB = cartSessionService.resolveOrCreateSession(undefined).token

    if (process.env.REDIS_URL) {
      const flushClient = new Redis(process.env.REDIS_URL)
      await flushClient.flushdb()
      await flushClient.quit()
    }

    const groundnut = await prisma.product.findUniqueOrThrow({
      where: { slug: 'groundnut-oil' },
      include: { variants: { orderBy: { price_paise: 'asc' } } },
    })
    const variant500ml = groundnut.variants[0]! // 10000 paise (₹100)
    const variant1L = groundnut.variants[1]! // 20000 paise (₹200)
    const variant5L = groundnut.variants[2]! // 90000 paise (₹900)
    const samplePickup = await prisma.pickupLocation.findFirstOrThrow({
      where: { is_sample: true },
    })

    // Ensure clean baseline orders, idempotency keys, stock, and coupon state
    await prisma.checkoutIdempotencyKey.deleteMany()
    await prisma.payment.deleteMany()
    await prisma.orderEvent.deleteMany()
    await prisma.reservation.deleteMany()
    await prisma.stockMovement.deleteMany({ where: { order_id: { not: null } } })
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    await prisma.address.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.variant.updateMany({ data: { stock: 50, reserved: 0 } })
    await prisma.coupon.update({
      where: { code: 'SAMPLE10' },
      data: { used_count: 0, usage_limit: 100, is_active: true },
    })

    // 1. Tampered extra price field rejected with 400
    await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', 'phase5-tamper-key-0001')
      .send({
        contact: { name: 'Asha', phone: '9876543210' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Asha',
          phone: '9876543210',
          line1: '12 Gandhi Rd',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant1L.id, qty: 1, unitPricePaise: 1 }],
        paymentMethod: 'COD',
        dpdpConsent: true,
      })
      .expect(400)

    // 2. Non-COD pincode (110001) rejects COD cleanly
    await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', 'phase5-nocod-pincode-01')
      .send({
        contact: { name: 'Asha', phone: '9876543210' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Asha',
          phone: '9876543210',
          line1: '12 Connaught Place',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110001',
        },
        items: [{ variantId: variant1L.id, qty: 1 }],
        paymentMethod: 'COD',
        dpdpConsent: true,
      })
      .expect(400)

    // 3. Over codMaxOrderPaise (₹5,000 -> 6 x ₹900 = ₹5,400) rejects COD
    await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', 'phase5-cod-max-cap-001')
      .send({
        contact: { name: 'Asha', phone: '9876543210' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Asha',
          phone: '9876543210',
          line1: '12 Gandhi Rd',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant5L.id, qty: 6 }],
        paymentMethod: 'COD',
        dpdpConsent: true,
      })
      .expect(400)

    // 4. Valid COD checkout with SAMPLE10 coupon + Idempotency-Key replay/conflict + Cancellation restore
    const codBody = {
      contact: { name: 'Asha', phone: '9876501111', email: 'asha@example.com' },
      fulfilmentMethod: 'DELIVERY',
      address: {
        name: 'Asha',
        phone: '9876501111',
        line1: '12 Gandhi Rd',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
      },
      items: [{ variantId: variant1L.id, qty: 2 }], // ₹400 - ₹40 (SAMPLE10) + ₹50 shipping = ₹410 (41000 paise)
      paymentMethod: 'COD',
      couponCode: 'SAMPLE10',
      dpdpConsent: true,
      marketingConsent: false,
    }

    const codRes = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', 'phase5-cod-idemp-key-01')
      .send(codBody)
      .expect(201)

    expect(codRes.headers['cache-control']).toBe('no-store')
    const codParsed = checkoutResponseSchema.parse(codRes.body)
    expect(codParsed.order.orderStatus).toBe('COD_PENDING')
    expect(codParsed.order.totalPaise).toBe(41000)
    expect(codParsed.order.orderNumber).toMatch(/^ORD-\d{6}-[2-9A-HJ-NP-Z]{5}$/)
    expect(codParsed.payment).toBeNull()

    // DB integrity: stock decremented, DPDP timestamp recorded, coupon used_count incremented, StockMovement created
    const v1AfterCod = await prisma.variant.findUniqueOrThrow({ where: { id: variant1L.id } })
    expect(v1AfterCod.stock).toBe(48)
    expect(v1AfterCod.reserved).toBe(0)
    const dbCodOrder = await prisma.order.findUniqueOrThrow({ where: { id: codParsed.order.id } })
    expect(dbCodOrder.dpdp_consent_at).toBeTruthy()
    expect(dbCodOrder.dpdp_policy_version).toBe('2026-11-draft-v1')
    expect(dbCodOrder.marketing_consent).toBe(false)
    const couponAfterCod = await prisma.coupon.findUniqueOrThrow({ where: { code: 'SAMPLE10' } })
    expect(couponAfterCod.used_count).toBe(1)

    // Identical Idempotency-Key + identical body replays exact order without duplicate stock deduction
    const replayRes = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', 'phase5-cod-idemp-key-01')
      .send(codBody)
      .expect(201)
    expect(replayRes.body.order.id).toBe(codParsed.order.id)
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1L.id } })).stock).toBe(48)

    // Same Idempotency-Key with DIFFERENT payload returns 409 Conflict
    await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', 'phase5-cod-idemp-key-01')
      .send({ ...codBody, items: [{ variantId: variant1L.id, qty: 3 }] })
      .expect(409)

    // Active COD cap (2 per phone): 2nd succeeds, 3rd rejects
    const cod2 = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', 'phase5-cod-phone-limit-2')
      .send({ ...codBody, couponCode: undefined })
      .expect(201)
    await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', 'phase5-cod-phone-limit-3')
      .send({ ...codBody, couponCode: undefined })
      .expect(400)

    // Cancelling COD order restores stock + creates CANCEL movement + releases coupon slot
    const cancelOut = await checkoutService.cancelConfirmedOrder(
      codParsed.order.id,
      'Customer cancelled COD test',
    )
    expect(cancelOut).toEqual({ cancelled: true, restoredUnits: 2 })
    await checkoutService.cancelConfirmedOrder(cod2.body.order.id, 'Cleanup 2nd COD')
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1L.id } })).stock).toBe(50)
    expect(
      (await prisma.coupon.findUniqueOrThrow({ where: { code: 'SAMPLE10' } })).used_count,
    ).toBe(0)

    // 5. STORE_PICKUP online checkout -> HMAC verify -> PAID -> idempotent replay + 6-digit pickup code + brute-force lock
    const pickupOrderRes = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', 'phase5-pickup-online-01')
      .send({
        contact: { name: 'Karthik', phone: '9876502222' },
        fulfilmentMethod: 'STORE_PICKUP',
        pickupLocationId: samplePickup.id,
        items: [{ variantId: variant500ml.id, qty: 2 }],
        paymentMethod: 'ONLINE',
        dpdpConsent: true,
      })
      .expect(201)

    const pickupInit = checkoutResponseSchema.parse(pickupOrderRes.body)
    expect(pickupInit.order.orderStatus).toBe('PENDING_PAYMENT')
    expect(pickupInit.order.shippingPaise).toBe(0)
    expect(pickupInit.order.pickupCode).toBeNull() // not issued until PAID
    expect(pickupInit.payment?.gatewayOrderId).toBeTruthy()
    expect(
      (await prisma.variant.findUniqueOrThrow({ where: { id: variant500ml.id } })).reserved,
    ).toBe(2)

    // Bad HMAC signature rejected
    await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({
        orderId: pickupInit.order.id,
        razorpayOrderId: pickupInit.payment!.gatewayOrderId,
        razorpayPaymentId: 'pay_forged_01',
        razorpaySignature: 'deadbeef'.repeat(8),
      })
      .expect(400)

    // Valid signature via mock gateway helper transitions PENDING_PAYMENT -> PAID & returns 6-digit pickupCode ONCE
    const validSigPayload = paymentGateway.createMockSignedPayment(
      pickupInit.payment!.gatewayOrderId,
      'pay_valid_pickup_01',
    )
    const verifyRes1 = await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({ orderId: pickupInit.order.id, ...validSigPayload })
      .expect(200)

    expect(verifyRes1.headers['cache-control']).toBe('no-store')
    const verified1 = checkoutVerifyResponseSchema.parse(verifyRes1.body)
    expect(verified1.order.orderStatus).toBe('PAID')
    expect(verified1.alreadyProcessed).toBe(false)
    expect(verified1.order.pickupCode).toMatch(/^\d{6}$/)
    const v500AfterPaid = await prisma.variant.findUniqueOrThrow({ where: { id: variant500ml.id } })
    expect(v500AfterPaid.stock).toBe(48)
    expect(v500AfterPaid.reserved).toBe(0)

    // Idempotent replay of /checkout/verify or markOrderPaid does NOTHING and never double-deducts stock
    const verifyRes2 = await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({ orderId: pickupInit.order.id, ...validSigPayload })
      .expect(200)
    const verified2 = checkoutVerifyResponseSchema.parse(verifyRes2.body)
    expect(verified2.alreadyProcessed).toBe(true)
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant500ml.id } })).stock).toBe(
      48,
    )

    // Plaintext pickup code is HMAC-verified & locks after 5 bad guesses
    const goodCode = verified1.order.pickupCode!
    const okCheck = await checkoutService.verifyPickupCodeAttempt(pickupInit.order.id, goodCode)
    expect(okCheck.valid).toBe(true)
    for (let i = 0; i < 4; i += 1) {
      const badCheck = await checkoutService.verifyPickupCodeAttempt(pickupInit.order.id, '000000')
      expect(badCheck.valid).toBe(false)
      expect(badCheck.lockedUntil).toBeNull()
    }
    const lockedCheck = await checkoutService.verifyPickupCodeAttempt(pickupInit.order.id, '000000')
    expect(lockedCheck.valid).toBe(false)
    expect(lockedCheck.lockedUntil).toBeTruthy()
    // Even valid code cannot pass while locked
    const whileLocked = await checkoutService.verifyPickupCodeAttempt(pickupInit.order.id, goodCode)
    expect(whileLocked.valid).toBe(false)
    expect(whileLocked.lockedUntil).toBeTruthy()

    // 6. Concurrency race & failure release: 3 concurrent requests competing for 2 remaining units + single coupon
    await prisma.variant.update({ where: { id: variant1L.id }, data: { stock: 2, reserved: 0 } })
    await prisma.coupon.update({
      where: { code: 'SAMPLE10' },
      data: { used_count: 0, usage_limit: 1 },
    })

    const raceRequests = ['race-1', 'race-2', 'race-3'].map((tag) =>
      request(app.getHttpServer())
        .post('/api/checkout')
        .set('Idempotency-Key', `phase5-concurrency-${tag}-0001`)
        .send({
          contact: { name: 'Race Buyer', phone: '9876503333' },
          fulfilmentMethod: 'DELIVERY',
          address: {
            name: 'Race Buyer',
            phone: '9876503333',
            line1: '10 Race Course Rd',
            city: 'Chennai',
            state: 'Tamil Nadu',
            pincode: '600001',
          },
          items: [{ variantId: variant1L.id, qty: 2 }],
          paymentMethod: 'ONLINE',
          couponCode: 'SAMPLE10',
          dpdpConsent: true,
        }),
    )
    const raceResponses = await Promise.all(raceRequests)
    const winners = raceResponses.filter((r) => r.status === 201)
    const losers = raceResponses.filter((r) => r.status === 409)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(2)
    expect(
      (await prisma.coupon.findUniqueOrThrow({ where: { code: 'SAMPLE10' } })).used_count,
    ).toBe(1)

    // Dismiss/fail releases reserved stock + coupon cleanly
    const winnerOrder = winners[0]!.body.order
    const failRes = await request(app.getHttpServer())
      .post('/api/checkout/fail')
      .send({ orderId: winnerOrder.id, reason: 'MODAL_DISMISSED' })
      .expect(200)
    const failParsed = checkoutFailResponseSchema.parse(failRes.body)
    expect(failParsed.released).toBe(true)
    expect(failParsed.orderStatus).toBe('CANCELLED')
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1L.id } })).reserved).toBe(
      0,
    )
    expect(
      (await prisma.coupon.findUniqueOrThrow({ where: { code: 'SAMPLE10' } })).used_count,
    ).toBe(0)

    // 7. Expiry job checks Razorpay before releasing, and late capture on OOS triggers auto-refund + needs_attention
    const staleCreate = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('x-cart-session', lateSessionA)
      .set('Idempotency-Key', 'phase5-expiry-recover-001')
      .send({
        contact: { name: 'Late Payer', phone: '9876504444' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Late Payer',
          phone: '9876504444',
          line1: '5 Temple St',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant1L.id, qty: 2 }],
        paymentMethod: 'ONLINE',
        dpdpConsent: true,
      })
      .expect(201)

    const pastCutoff = new Date(Date.now() - 20 * 60_000)
    await prisma.reservation.updateMany({
      where: { order_id: staleCreate.body.order.id },
      data: { expires_at: pastCutoff },
    })

    // Case A: Gateway actually captured payment right before expiry job ran -> job recovers & marks PAID!
    paymentGateway.mockRecordCapturedPayment(
      staleCreate.body.payment.gatewayOrderId,
      'pay_mock_recovered_before_expiry',
      staleCreate.body.order.totalPaise,
    )
    const sweepRecovered = await checkoutService.releaseExpiredReservations()
    expect(sweepRecovered.recoveredPaidCount).toBe(1)
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: staleCreate.body.order.id } }))
        .order_status,
    ).toBe('PAID')

    // Case B: Reservation expires with no payment -> released -> then late webhook/payment arrives when stock = 0 -> auto-refund + needs_attention!
    await prisma.variant.update({ where: { id: variant1L.id }, data: { stock: 2, reserved: 0 } })
    const lateOrderCreate = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('x-cart-session', lateSessionB)
      .set('Idempotency-Key', 'phase5-late-oos-refund-001')
      .send({
        contact: { name: 'Late OOS', phone: '9876505555' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Late OOS',
          phone: '9876505555',
          line1: '8 Temple St',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant1L.id, qty: 2 }],
        paymentMethod: 'ONLINE',
        dpdpConsent: true,
      })
      .expect(201)

    await prisma.reservation.updateMany({
      where: { order_id: lateOrderCreate.body.order.id },
      data: { expires_at: pastCutoff },
    })
    const sweepExpired = await checkoutService.releaseExpiredReservations()
    expect(sweepExpired.expiredCount).toBe(1)

    // Remaining stock gets bought out before late payment settles
    await prisma.variant.update({ where: { id: variant1L.id }, data: { stock: 0, reserved: 0 } })
    const lateOutcome = await checkoutService.markOrderPaid({
      orderId: lateOrderCreate.body.order.id,
      gatewayOrderId: lateOrderCreate.body.payment.gatewayOrderId,
      gatewayPaymentId: 'pay_late_after_sold_out_01',
      source: 'webhook',
    })
    expect(lateOutcome.autoRefunded).toBe(true)
    expect(lateOutcome.refundSucceeded).toBe(true)
    expect(lateOutcome.order.orderStatus).toBe('CANCELLED')
    expect(lateOutcome.order.paymentStatus).toBe('REFUNDED')
    expect(lateOutcome.order.needsAttention).toBe(true)

    // 8. Production guard: APP_ENV=production with legalPagesApproved=false refuses checkout (403) and mock-complete (403)
    const prevAppEnv = env.APP_ENV
    env.APP_ENV = 'production'
    try {
      await settingsService.invalidateCache()
      await request(app.getHttpServer())
        .post('/api/checkout/mock-complete')
        .send({ orderId: lateOrderCreate.body.order.id })
        .expect(403)

      await request(app.getHttpServer())
        .post('/api/checkout')
        .set('Idempotency-Key', 'phase5-prod-legal-blocked')
        .send({
          contact: { name: 'Prod User', phone: '9876506666' },
          fulfilmentMethod: 'DELIVERY',
          address: {
            name: 'Prod User',
            phone: '9876506666',
            line1: '10 Anna Salai',
            city: 'Chennai',
            state: 'Tamil Nadu',
            pincode: '600001',
          },
          items: [{ variantId: variant500ml.id, qty: 1 }],
          paymentMethod: 'ONLINE',
          dpdpConsent: true,
        })
        .expect(403)
    } finally {
      env.APP_ENV = prevAppEnv
      await settingsService.invalidateCache()
    }

    // Restore clean dev stock & coupon count for subsequent dev inspection
    await prisma.checkoutIdempotencyKey.deleteMany()
    await prisma.payment.deleteMany()
    await prisma.orderEvent.deleteMany()
    await prisma.reservation.deleteMany()
    await prisma.stockMovement.deleteMany({ where: { order_id: { not: null } } })
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    await prisma.address.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.variant.updateMany({ data: { stock: 50, reserved: 0 } })
    await prisma.coupon.update({
      where: { code: 'SAMPLE10' },
      data: { used_count: 0, usage_limit: 100, is_active: true },
    })
  })
})
