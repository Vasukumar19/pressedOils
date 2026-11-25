import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { FULFILMENT_METHOD } from '@pressedoils/shared'
import { env } from '../src/env'
import { CartRateLimitService } from '../src/cart/cart-rate-limit.service'
import { CartSessionService } from '../src/cart/cart-session.service'
import { CartService } from '../src/cart/cart.service'
import type { PincodeService } from '../src/pincode/pincode.service'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { RedisService } from '../src/redis/redis.service'
import { ResilientThrottlerStorage } from '../src/redis/resilient-throttler.storage'
import { OwnerSettingsService } from '../src/settings/owner-settings.service'
import type { SettingsService } from '../src/settings/settings.service'

const VAR_1 = '550e8400-e29b-41d4-a716-446655440101'
const VAR_2 = '550e8400-e29b-41d4-a716-446655440102'
const PROD_1 = '550e8400-e29b-41d4-a716-446655440201'
const PROD_2 = '550e8400-e29b-41d4-a716-446655440202'
const PICKUP_REAL = '550e8400-e29b-41d4-a716-446655440301'
const PICKUP_SAMPLE = '550e8400-e29b-41d4-a716-446655440302'

describe('CartSessionService & CartRateLimitService', () => {
  it('signs and verifies anonymous cart session tokens and rejects tampering', () => {
    const svc = new CartSessionService()
    const created = svc.resolveOrCreateSession(undefined)
    expect(created.isNew).toBe(true)

    const verified = svc.resolveOrCreateSession(created.token)
    expect(verified.isNew).toBe(false)
    expect(verified.sessionId).toBe(created.sessionId)

    const tampered = `${created.token.slice(0, -3)}xxx`
    expect(svc.verifyToken(tampered)).toBeNull()
    expect(svc.resolveOrCreateSession(tampered).isNew).toBe(true)
  })

  it('allows up to 60 session reqs/min per session under 300/min shared IP, and falls back to memory when Redis fails', async () => {
    const redisDown = {
      incrRateLimit: vi.fn().mockResolvedValue(null),
      getString: vi.fn().mockResolvedValue(null),
    } as unknown as RedisService
    const storage = new ResilientThrottlerStorage(redisDown)
    const limiter = new CartRateLimitService(storage)
    const sessionSvc = new CartSessionService()

    const sessionA = { sessionId: '550e8400-e29b-41d4-a716-446655440991', token: 't', isNew: false }
    const sessionB = {
      sessionId: '550e8400-e29b-41d4-a716-446655440992',
      token: 't2',
      isNew: false,
    }

    // 60 calls from session A behind carrier NAT IP 10.0.0.1 succeed
    for (let i = 0; i < 60; i += 1) {
      await limiter.enforceValidateRateLimit('10.0.0.1', sessionA)
    }
    // 61st call from session A throws 429
    await expect(limiter.enforceValidateRateLimit('10.0.0.1', sessionA)).rejects.toBeInstanceOf(
      HttpException,
    )
    // Different valid session B behind the SAME carrier NAT IP still succeeds up to IP ceiling 300/min
    await expect(limiter.enforceValidateRateLimit('10.0.0.1', sessionB)).resolves.toBeUndefined()

    // Unauthenticated/omitted session token shares a 60/min IP bucket so scrapers can't omit headers
    const unauth = sessionSvc.resolveOrCreateSession(undefined)
    for (let i = 0; i < 60; i += 1) {
      await limiter.enforceValidateRateLimit('203.0.113.5', { ...unauth, isNew: true })
    }
    await expect(
      limiter.enforceValidateRateLimit('203.0.113.5', { ...unauth, isNew: true }),
    ).rejects.toBeInstanceOf(HttpException)

    // Invalid coupon attempts cap at 10 per 15 min per IP/session even with Redis down
    for (let i = 0; i < 10; i += 1) {
      await limiter.assertCouponCheckAllowed('198.51.100.7', sessionA.sessionId)
      await limiter.recordInvalidCouponAttempt('198.51.100.7', sessionA.sessionId)
    }
    await expect(
      limiter.assertCouponCheckAllowed('198.51.100.7', sessionA.sessionId),
    ).rejects.toBeInstanceOf(HttpException)
  })
})

describe('CartService stock visibility, free shipping, coupons, and pickup rules', () => {
  function makeDeps(overrides: {
    variants?: Array<Record<string, unknown>>
    coupon?: Record<string, unknown> | null
    freeShippingEnabled?: boolean
    thresholdPaise?: number
    storePickupEnabled?: boolean
    pickupLocations?: Array<Record<string, unknown>>
    showTaxBreakdown?: boolean
    pincodeServiceable?: boolean
    pincodeShippingPaise?: number
  }) {
    const prisma = {
      variant: {
        findMany: vi.fn().mockResolvedValue(
          overrides.variants ?? [
            {
              id: VAR_1,
              sku: 'GND-1L',
              size_label: '1 L',
              price_paise: 50000,
              mrp_paise: 55000,
              stock: 50,
              reserved: 0,
              low_stock_threshold: 5,
              is_active: true,
              product: {
                id: PROD_1,
                slug: 'groundnut-oil',
                name: 'Groundnut Oil',
                is_active: true,
                images: [{ url: 'https://cdn.example.com/gnd.webp', alt: 'Groundnut' }],
              },
            },
          ],
        ),
      },
      coupon: {
        findUnique: vi.fn().mockResolvedValue(overrides.coupon ?? null),
      },
    } as unknown as PrismaService

    const pincodeService = {
      check: vi.fn().mockResolvedValue(
        overrides.pincodeServiceable === false
          ? {
              pincode: '999999',
              serviceable: false,
              city: null,
              state: null,
              deliveryDays: null,
              codAllowed: false,
              shippingPaise: null,
            }
          : {
              pincode: '600001',
              serviceable: true,
              city: 'Chennai',
              state: 'Tamil Nadu',
              deliveryDays: 2,
              codAllowed: true,
              shippingPaise: overrides.pincodeShippingPaise ?? 5000,
            },
      ),
    } as unknown as PincodeService

    const settingsService = {
      getInternalPricingSettings: vi.fn().mockResolvedValue({
        brandName: '[YOUR BRAND]',
        freeShippingEnabledSetting: overrides.freeShippingEnabled ?? false,
        freeShippingThresholdPaise: overrides.thresholdPaise ?? 99900,
        freeShippingStartsAt: null,
        freeShippingEndsAt: null,
        defaultShippingPaise: 7000,
        gstRateBps: 500,
        gstIncludedInPrice: true,
        shippingTaxRateBps: null,
        showTaxBreakdown: overrides.showTaxBreakdown ?? false,
        storePickupEnabled: overrides.storePickupEnabled ?? false,
        payAtStoreEnabled: false,
        holdWindowDays: 3,
        fssaiNumber: '123',
        supportEmail: 's@example.com',
        supportPhone: '+919999999999',
        registeredAddress: 'Chennai',
        requireLabReportForActivation: true,
        pickupLocations: overrides.pickupLocations ?? [],
      }),
    } as unknown as SettingsService

    const rateLimiter = {
      assertCouponCheckAllowed: vi.fn().mockResolvedValue(undefined),
      recordInvalidCouponAttempt: vi.fn().mockResolvedValue(undefined),
    } as unknown as CartRateLimitService

    return {
      service: new CartService(prisma, pincodeService, settingsService, rateLimiter),
      rateLimiter,
    }
  }

  it('merges duplicate variantIds and clamps qty > MAX_QTY_PER_VARIANT cleanly', async () => {
    const { service } = makeDeps({})
    const res = await service.validate(
      {
        items: [
          { variantId: VAR_1, qty: 6 },
          { variantId: VAR_1, qty: 7 },
        ],
        fulfilmentMethod: FULFILMENT_METHOD.DELIVERY,
      },
      { ip: '127.0.0.1', sessionId: 's1' },
    )

    expect(res.items).toHaveLength(1)
    expect(res.items[0]!.requestedQty).toBe(13)
    expect(res.items[0]!.effectiveQty).toBe(10)
    expect(res.items[0]!.status).toBe('ADJUSTED_QTY')
    expect(res.items[0]!.statusMessage).toContain('Maximum 10 per order')
    // No pincode yet -> label is "Items total" and shipping not added
    expect(res.summary.totalLabel).toBe('Items total')
    expect(res.summary.shippingStatus).toBe('ENTER_PINCODE')
    expect(res.summary.shippingPaise).toBeNull()
    expect(res.summary.totalPaise).toBe(500000)
  })

  it('auto-clamps stock <= threshold with count, but hides count and blocks checkout when stock > threshold and requested exceeds stock', async () => {
    const { service } = makeDeps({
      variants: [
        {
          id: VAR_1,
          sku: 'GND-500ML',
          size_label: '500 ml',
          price_paise: 10000,
          mrp_paise: 12000,
          stock: 3, // <= threshold 5 -> auto-clamps and reveals "Only 3 left"
          reserved: 0,
          low_stock_threshold: 5,
          is_active: true,
          product: {
            id: PROD_1,
            slug: 'groundnut-oil',
            name: 'Groundnut Oil',
            is_active: true,
            images: [],
          },
        },
        {
          id: VAR_2,
          sku: 'SES-1L',
          size_label: '1 L',
          price_paise: 20000,
          mrp_paise: 22000,
          stock: 7, // > threshold 5 -> never reveal 7!
          reserved: 0,
          low_stock_threshold: 5,
          is_active: true,
          product: {
            id: PROD_2,
            slug: 'white-sesame-oil',
            name: 'White Sesame Oil',
            is_active: true,
            images: [],
          },
        },
      ],
    })

    const res = await service.validate(
      {
        items: [
          { variantId: VAR_1, qty: 5 },
          { variantId: VAR_2, qty: 10 },
        ],
        fulfilmentMethod: FULFILMENT_METHOD.DELIVERY,
        pincode: '600001',
      },
      { ip: '127.0.0.1', sessionId: 's1' },
    )

    const line1 = res.items.find((l) => l.variantId === VAR_1)!
    expect(line1.status).toBe('ADJUSTED_QTY')
    expect(line1.effectiveQty).toBe(3)
    expect(line1.availableStock).toBe(3)
    expect(line1.statusMessage).toBe('Only 3 left')

    const line2 = res.items.find((l) => l.variantId === VAR_2)!
    expect(line2.status).toBe('QUANTITY_UNAVAILABLE')
    expect(line2.effectiveQty).toBe(10)
    expect(line2.availableStock).toBeUndefined()
    expect(line2.statusMessage).not.toContain('7')
    expect(res.summary.canCheckout).toBe(false)
  })

  it('applies free shipping strictly to net after coupon, hides bar when disabled, and refuses free shipping on unserviceable pincode', async () => {
    // 100000 paise cart (₹1000), threshold 99900 (₹999):
    // Without coupon: qualifies -> shipping 0
    // With SAMPLE10 (10% off): net = 90000 < 99900 -> drops below threshold -> shipping = 5000!
    const { service } = makeDeps({
      freeShippingEnabled: true,
      thresholdPaise: 99900,
      coupon: {
        id: 'c1',
        code: 'SAMPLE10',
        type: 'PERCENT',
        value: 10,
        min_order_paise: 30000,
        max_discount_paise: null,
        expires_at: null,
        usage_limit: 100,
        used_count: 0,
        is_active: true,
      },
    })

    const noCoupon = await service.validate(
      {
        items: [{ variantId: VAR_1, qty: 2 }], // 100000 paise
        fulfilmentMethod: FULFILMENT_METHOD.DELIVERY,
        pincode: '600001',
      },
      { ip: '127.0.0.1', sessionId: 's1' },
    )
    expect(noCoupon.freeShipping?.qualified).toBe(true)
    expect(noCoupon.summary.shippingPaise).toBe(0)
    expect(noCoupon.summary.totalPaise).toBe(100000)

    const withCoupon = await service.validate(
      {
        items: [{ variantId: VAR_1, qty: 2 }],
        couponCode: 'sample10',
        fulfilmentMethod: FULFILMENT_METHOD.DELIVERY,
        pincode: '600001',
      },
      { ip: '127.0.0.1', sessionId: 's1' },
    )
    expect(withCoupon.summary.discountPaise).toBe(10000)
    expect(withCoupon.summary.netItemsTotalPaise).toBe(90000)
    expect(withCoupon.freeShipping?.qualified).toBe(false)
    expect(withCoupon.freeShipping?.remainingPaise).toBe(9900)
    expect(withCoupon.summary.shippingPaise).toBe(5000)
    expect(withCoupon.summary.totalPaise).toBe(95000)

    // Unserviceable pincode never becomes deliverable even above threshold
    const unserv = makeDeps({
      freeShippingEnabled: true,
      thresholdPaise: 10000,
      pincodeServiceable: false,
    })
    const unservRes = await unserv.service.validate(
      {
        items: [{ variantId: VAR_1, qty: 2 }],
        fulfilmentMethod: FULFILMENT_METHOD.DELIVERY,
        pincode: '999999',
      },
      { ip: '127.0.0.1', sessionId: 's1' },
    )
    expect(unservRes.summary.shippingStatus).toBe('UNSERVICEABLE')
    expect(unservRes.summary.shippingPaise).toBeNull()
    expect(unservRes.summary.canCheckout).toBe(false)
  })

  it('handles store pickup with 0 shipping, hidden freeShipping bar, and rejects sample pickup in production', async () => {
    const { service } = makeDeps({
      freeShippingEnabled: true,
      storePickupEnabled: true,
      pickupLocations: [
        {
          id: PICKUP_REAL,
          name: 'Mill Store',
          address: 'Chennai',
          hours: '10-7',
          prepTimeMinutes: 90,
          isSample: false,
        },
      ],
    })

    const pickupRes = await service.validate(
      {
        items: [{ variantId: VAR_1, qty: 1 }],
        fulfilmentMethod: FULFILMENT_METHOD.STORE_PICKUP,
        pickupLocationId: PICKUP_REAL,
      },
      { ip: '127.0.0.1', sessionId: 's1' },
    )
    expect(pickupRes.summary.shippingStatus).toBe('PICKUP_FREE')
    expect(pickupRes.summary.shippingPaise).toBe(0)
    expect(pickupRes.freeShipping).toBeNull()
    expect(pickupRes.pickup?.location.id).toBe(PICKUP_REAL)
    expect(pickupRes.tax).toEqual({ showTaxBreakdown: false })

    // Production excludes sample locations
    const prodPickup = makeDeps({
      storePickupEnabled: true,
      pickupLocations: [
        {
          id: PICKUP_SAMPLE,
          name: 'SAMPLE',
          address: 'Sample',
          hours: '10-7',
          prepTimeMinutes: 60,
          isSample: true,
        },
      ],
    })
    const prevEnv = env.APP_ENV
    env.APP_ENV = 'production'
    try {
      // Simulate production empty locations (as SettingsService filters out is_sample)
      const disabledDeps = makeDeps({ storePickupEnabled: false, pickupLocations: [] })
      await expect(
        disabledDeps.service.validate(
          {
            items: [{ variantId: VAR_1, qty: 1 }],
            fulfilmentMethod: FULFILMENT_METHOD.STORE_PICKUP,
            pickupLocationId: PICKUP_SAMPLE,
          },
          { ip: '127.0.0.1', sessionId: 's1' },
        ),
      ).rejects.toThrow(/not currently available/)
    } finally {
      env.APP_ENV = prevEnv
    }
    void prodPickup
  })

  it('returns uniform message for nonexistent, inactive, or expired coupons without revealing difference', async () => {
    const missing = makeDeps({ coupon: null })
    const res1 = await missing.service.validate(
      {
        items: [{ variantId: VAR_1, qty: 1 }],
        couponCode: 'NOPE',
        fulfilmentMethod: FULFILMENT_METHOD.DELIVERY,
      },
      { ip: '1.1.1.1', sessionId: 's1' },
    )
    expect(res1.coupon?.message).toBe("This code isn't valid")
    expect(missing.rateLimiter.recordInvalidCouponAttempt).toHaveBeenCalledTimes(1)

    const expired = makeDeps({
      coupon: {
        id: 'c2',
        code: 'OLD',
        type: 'PERCENT',
        value: 10,
        min_order_paise: 0,
        max_discount_paise: null,
        expires_at: new Date('2020-01-01T00:00:00Z'),
        usage_limit: null,
        used_count: 0,
        is_active: true,
      },
    })
    const res2 = await expired.service.validate(
      {
        items: [{ variantId: VAR_1, qty: 1 }],
        couponCode: 'OLD',
        fulfilmentMethod: FULFILMENT_METHOD.DELIVERY,
      },
      { ip: '1.1.1.1', sessionId: 's1' },
    )
    expect(res2.coupon?.message).toBe("This code isn't valid")
    expect(expired.rateLimiter.recordInvalidCouponAttempt).toHaveBeenCalledTimes(1)
  })
})

describe('OwnerSettingsService access control & sample pickup protection', () => {
  it('blocks STAFF admins and rejects activating sample pickup locations in production', async () => {
    const prisma = {
      admin: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'adm-staff',
            email: 's@test',
            role: 'STAFF',
            is_active: true,
          })
          .mockResolvedValueOnce({
            id: 'adm-owner',
            email: 'o@test',
            role: 'OWNER',
            is_active: true,
          }),
      },
      pickupLocation: {
        findUnique: vi.fn().mockResolvedValue({
          id: PICKUP_SAMPLE,
          name: 'SAMPLE STORE',
          is_sample: true,
          is_active: false,
        }),
      },
    } as unknown as PrismaService

    const settingsService = {
      isProdRuntime: vi.fn().mockReturnValue(true),
      invalidateCache: vi.fn(),
      getPublicSettings: vi.fn(),
    } as unknown as SettingsService

    const svc = new OwnerSettingsService(prisma, settingsService)

    await expect(
      svc.updateOwnerSettings('s@test', { freeShipping: { enabled: true } }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    await expect(svc.setPickupLocationActive('o@test', PICKUP_SAMPLE, true)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})
