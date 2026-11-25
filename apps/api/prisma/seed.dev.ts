import 'dotenv/config'
import { AdminRole, CouponType, PrismaClient } from '@prisma/client'
import { SETTING_KEYS, STOCK_MOVEMENT_REASON } from '@pressedoils/shared'
import { assertDevSeedAllowed } from './seed-guard'

interface PlaceholderProductSeed {
  slug: string
  skuPrefix: string
  name: string
  description: string
  bestFor: string
  originRegion: string
  imageUrl: string
  imageAlt: string
  batchNo: string
  sortOrder: number
}

// PLACEHOLDER catalog data — lives exclusively in seed.dev.ts (never in production or UI components).
const PLACEHOLDER_PRODUCTS: PlaceholderProductSeed[] = [
  {
    slug: 'groundnut-oil',
    skuPrefix: 'GND',
    name: 'Groundnut Oil [PLACEHOLDER]',
    description:
      'PLACEHOLDER: Single-press unrefined groundnut oil settled naturally in small batches.',
    bestFor: 'PLACEHOLDER: Everyday frying & savoury cooking',
    originRegion: 'PLACEHOLDER REGION (e.g. Pollachi)',
    imageUrl: '/placeholders/groundnut.svg',
    imageAlt: 'Placeholder bottle illustration for Groundnut Oil',
    batchNo: 'PH-GND-001',
    sortOrder: 1,
  },
  {
    slug: 'white-sesame-oil',
    skuPrefix: 'WSES',
    name: 'White Sesame Oil [PLACEHOLDER]',
    description:
      'PLACEHOLDER: Slow-pressed white sesame oil with delicate nutty aroma, never bleached or deodorised.',
    bestFor: 'PLACEHOLDER: Everyday tempering, chutneys & finishing',
    originRegion: 'PLACEHOLDER REGION (e.g. Erode)',
    imageUrl: '/placeholders/white-sesame.svg',
    imageAlt: 'Placeholder bottle illustration for White Sesame Oil',
    batchNo: 'PH-WSES-001',
    sortOrder: 2,
  },
  {
    slug: 'black-sesame-oil',
    skuPrefix: 'BSES',
    name: 'Black Sesame Oil [PLACEHOLDER]',
    description: 'PLACEHOLDER: Rich cold-pressed black sesame oil pressed slowly in small batches.',
    bestFor: 'PLACEHOLDER: Pickles, traditional tempering & bold dishes',
    originRegion: 'PLACEHOLDER REGION (e.g. Karur)',
    imageUrl: '/placeholders/black-sesame.svg',
    imageAlt: 'Placeholder bottle illustration for Black Sesame Oil',
    batchNo: 'PH-BSES-001',
    sortOrder: 3,
  },
  {
    slug: 'sunflower-oil',
    skuPrefix: 'SUN',
    name: 'Sunflower Oil [PLACEHOLDER]',
    description: 'PLACEHOLDER: Light cold-pressed sunflower seed oil, unrefined.',
    bestFor: 'PLACEHOLDER: Light sautéing & everyday baking',
    originRegion: 'PLACEHOLDER REGION (e.g. Latur)',
    imageUrl: '/placeholders/sunflower.svg',
    imageAlt: 'Placeholder bottle illustration for Sunflower Oil',
    batchNo: 'PH-SUN-001',
    sortOrder: 4,
  },
  {
    slug: 'safflower-oil',
    skuPrefix: 'SAF',
    name: 'Safflower Oil [PLACEHOLDER]',
    description: 'PLACEHOLDER: Cold-pressed kardi (safflower) oil extracted in small runs.',
    bestFor: 'PLACEHOLDER: Gentle pan cooking & dressings',
    originRegion: 'PLACEHOLDER REGION (e.g. Marathwada)',
    imageUrl: '/placeholders/safflower.svg',
    imageAlt: 'Placeholder bottle illustration for Safflower Oil',
    batchNo: 'PH-SAF-001',
    sortOrder: 5,
  },
  {
    slug: 'coconut-oil',
    skuPrefix: 'COC',
    name: 'Coconut Oil [PLACEHOLDER]',
    description: 'PLACEHOLDER: Cold-pressed mature coconut kernel oil filtered once.',
    bestFor: 'PLACEHOLDER: Fragrant curries & festival cooking',
    originRegion: 'PLACEHOLDER REGION (e.g. Kangeyam)',
    imageUrl: '/placeholders/coconut.svg',
    imageAlt: 'Placeholder bottle illustration for Coconut Oil',
    batchNo: 'PH-COC-001',
    sortOrder: 6,
  },
]

const PLACEHOLDER_VARIANTS = [
  { code: '500ML', sizeLabel: '500 ml', pricePaise: 10000, mrpPaise: 12000, stock: 50 },
  { code: '1L', sizeLabel: '1 L', pricePaise: 20000, mrpPaise: 24000, stock: 50 },
  { code: '5L', sizeLabel: '5 L', pricePaise: 90000, mrpPaise: 105000, stock: 50 },
] as const

const DEPRECATED_SAMPLE_SLUGS = ['mustard-oil', 'sesame-gingelly-oil']

async function seedDev() {
  assertDevSeedAllowed(process.env)

  const prisma = new PrismaClient()
  try {
    // Clean up removed legacy sample slugs if not referenced by orders
    for (const oldSlug of DEPRECATED_SAMPLE_SLUGS) {
      const existingOld = await prisma.product.findUnique({ where: { slug: oldSlug } })
      if (existingOld) {
        const orderRefs = await prisma.orderItem.count({
          where: { variant: { product_id: existingOld.id } },
        })
        if (orderRefs === 0) {
          await prisma.stockMovement.deleteMany({
            where: { variant: { product_id: existingOld.id } },
          })
          await prisma.batch.deleteMany({ where: { product_id: existingOld.id } })
          await prisma.product.delete({ where: { id: existingOld.id } })
        }
      }
    }

    const pressedOn = new Date('2026-01-15T00:00:00.000Z')
    const bestBefore = new Date('2026-10-15T00:00:00.000Z')
    const labTestedOn = new Date('2026-01-18T00:00:00.000Z')

    for (const item of PLACEHOLDER_PRODUCTS) {
      const product = await prisma.product.upsert({
        where: { slug: item.slug },
        update: {
          name: item.name,
          description: item.description,
          best_for: item.bestFor,
          origin_region: item.originRegion,
          is_active: true,
          sort_order: item.sortOrder,
          brand: '[YOUR BRAND]',
        },
        create: {
          slug: item.slug,
          name: item.name,
          description: item.description,
          best_for: item.bestFor,
          origin_region: item.originRegion,
          is_active: true,
          sort_order: item.sortOrder,
          brand: '[YOUR BRAND]',
        },
      })

      const existingImages = await prisma.productImage.findMany({
        where: { product_id: product.id },
        orderBy: { sort_order: 'asc' },
      })
      if (existingImages.length === 0 || existingImages[0]?.url !== item.imageUrl) {
        await prisma.productImage.deleteMany({ where: { product_id: product.id } })
        await prisma.productImage.create({
          data: {
            product_id: product.id,
            url: item.imageUrl,
            alt: item.imageAlt,
            sort_order: 0,
          },
        })
      }

      for (const v of PLACEHOLDER_VARIANTS) {
        const sku = `PH-${item.skuPrefix}-${v.code}`
        const existingVariant = await prisma.variant.findUnique({ where: { sku } })
        const variant = await prisma.variant.upsert({
          where: { sku },
          update: {
            size_label: v.sizeLabel,
            price_paise: v.pricePaise,
            mrp_paise: v.mrpPaise,
            is_active: true,
          },
          create: {
            product_id: product.id,
            sku,
            size_label: v.sizeLabel,
            price_paise: v.pricePaise,
            mrp_paise: v.mrpPaise,
            stock: v.stock,
            reserved: 0,
            low_stock_threshold: 5,
            is_active: true,
          },
        })

        if (!existingVariant) {
          await prisma.stockMovement.create({
            data: {
              variant_id: variant.id,
              delta: v.stock,
              reason: STOCK_MOVEMENT_REASON.INITIAL_SEED,
              actor: 'seed:dev',
            },
          })
        }
      }

      await prisma.batch.updateMany({
        where: { product_id: product.id, batch_no: { not: item.batchNo }, is_current: true },
        data: { is_current: false },
      })

      await prisma.batch.upsert({
        where: {
          product_id_batch_no: {
            product_id: product.id,
            batch_no: item.batchNo,
          },
        },
        update: {
          pressed_on: pressedOn,
          best_before: bestBefore,
          lab_report_url: '/placeholders/lab-report-placeholder.pdf',
          lab_tested_on: labTestedOn,
          is_current: true,
          is_active: true,
        },
        create: {
          product_id: product.id,
          batch_no: item.batchNo,
          pressed_on: pressedOn,
          best_before: bestBefore,
          lab_report_url: '/placeholders/lab-report-placeholder.pdf',
          lab_tested_on: labTestedOn,
          is_current: true,
          is_active: true,
        },
      })
    }

    const defaultSettings: Array<{ key: string; value: object }> = [
      { key: SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE, value: { amountPaise: 99900 } },
      {
        key: SETTING_KEYS.FREE_SHIPPING_CONFIG,
        value: { enabled: false, thresholdPaise: 99900, startsAt: null, endsAt: null },
      },
      { key: SETTING_KEYS.DEFAULT_SHIPPING_PAISE, value: { amountPaise: 7000 } },
      {
        key: SETTING_KEYS.GST_CONFIG,
        value: {
          rateBps: 500,
          includedInPrice: true,
          hsnCode: '15089091',
          shippingTaxRateBps: null,
          isSample: true,
        },
      },
      {
        key: SETTING_KEYS.TAX_DISPLAY_CONFIG,
        value: { showTaxBreakdown: false },
      },
      {
        key: SETTING_KEYS.STORE_PICKUP_CONFIG,
        value: { enabled: true, payAtStoreEnabled: false, holdWindowDays: 3 },
      },
      {
        key: SETTING_KEYS.STORE_INFO,
        value: {
          brandName: '[YOUR BRAND]',
          fssaiNumber: '[FSSAI NO. PLACEHOLDER]',
          supportEmail: 'support@example.invalid',
          supportPhone: '+910000000000',
          registeredAddress: '[REGISTERED ADDRESS PLACEHOLDER]',
        },
      },
      { key: SETTING_KEYS.REQUIRE_LAB_REPORT_FOR_ACTIVATION, value: { enabled: true } },
    ]

    for (const s of defaultSettings) {
      await prisma.setting.upsert({
        where: { key: s.key },
        update: { value: s.value },
        create: { key: s.key, value: s.value },
      })
    }

    const samplePincodes = [
      {
        pincode: '600001',
        city: 'Chennai',
        state: 'Tamil Nadu',
        delivery_days: 2,
        cod_allowed: true,
        shipping_paise: 5000,
      },
      {
        pincode: '560001',
        city: 'Bengaluru',
        state: 'Karnataka',
        delivery_days: 3,
        cod_allowed: true,
        shipping_paise: 6000,
      },
      {
        pincode: '400001',
        city: 'Mumbai',
        state: 'Maharashtra',
        delivery_days: 4,
        cod_allowed: true,
        shipping_paise: 7000,
      },
    ]

    for (const p of samplePincodes) {
      await prisma.serviceablePincode.upsert({
        where: { pincode: p.pincode },
        update: {
          city: p.city,
          state: p.state,
          delivery_days: p.delivery_days,
          cod_allowed: p.cod_allowed,
          shipping_paise: p.shipping_paise,
          is_active: true,
        },
        create: { ...p, is_active: true },
      })
    }

    await prisma.coupon.upsert({
      where: { code: 'SAMPLE10' },
      update: {
        type: CouponType.PERCENT,
        value: 10,
        min_order_paise: 30000,
        is_active: true,
      },
      create: {
        code: 'SAMPLE10',
        type: CouponType.PERCENT,
        value: 10,
        min_order_paise: 30000,
        usage_limit: 100,
        is_active: true,
      },
    })

    await prisma.admin.upsert({
      where: { email: 'owner-dev@example.invalid' },
      update: { role: AdminRole.OWNER, is_active: true },
      create: {
        email: 'owner-dev@example.invalid',
        password_hash: null,
        must_set_password: true,
        role: AdminRole.OWNER,
        is_active: true,
      },
    })

    const existingSamplePickup = await prisma.pickupLocation.findFirst({
      where: { is_sample: true },
    })
    if (existingSamplePickup) {
      await prisma.pickupLocation.update({
        where: { id: existingSamplePickup.id },
        data: {
          name: 'SAMPLE STORE (Not a real pickup address)',
          address: 'SAMPLE: 00 Press Mill Lane, Placeholder Nagar, Chennai 600001',
          hours: 'Mon–Sat 10:00 AM – 7:00 PM IST (Sample)',
          prep_time_minutes: 120,
          is_active: true,
          is_sample: true,
        },
      })
    } else {
      await prisma.pickupLocation.create({
        data: {
          name: 'SAMPLE STORE (Not a real pickup address)',
          address: 'SAMPLE: 00 Press Mill Lane, Placeholder Nagar, Chennai 600001',
          hours: 'Mon–Sat 10:00 AM – 7:00 PM IST (Sample)',
          prep_time_minutes: 120,
          is_active: true,
          is_sample: true,
        },
      })
    }

    console.log('✅  seed:dev completed (6 placeholder products, 18 variants, 6 batches)')
  } finally {
    await prisma.$disconnect()
  }
}

seedDev().catch((err) => {
  console.error('❌  seed:dev failed:', err)
  process.exit(1)
})
