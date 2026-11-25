import { describe, expect, it } from 'vitest'
import {
  canActivateProduct,
  canTransitionOrderStatus,
  checkoutRequestSchema,
  computePublicAvailability,
  formatDateIndia,
  formatPaiseToInr,
  indianPhoneSchema,
  indianPincodeSchema,
  isPlaceholderUrl,
  ORDER_STATUS,
  paiseSchema,
  pincodeLookupResponseSchema,
  productListQuerySchema,
  productionImageUrlSchema,
  publicProductSchema,
  shouldShowSampleDataBanner,
} from './index'

describe('money and currency helpers', () => {
  it('accepts non-negative integers in paise and rejects floats or negatives', () => {
    expect(paiseSchema.parse(0)).toBe(0)
    expect(paiseSchema.parse(10000)).toBe(10000)
    expect(() => paiseSchema.parse(100.5)).toThrow()
    expect(() => paiseSchema.parse(-1)).toThrow()
  })

  it('formats paise to INR cleanly', () => {
    expect(formatPaiseToInr(10000)).toBe('₹100')
    expect(formatPaiseToInr(90050)).toBe('₹900.50')
    expect(() => formatPaiseToInr(12.5)).toThrow()
  })

  it('formats dates in India timezone (Asia/Kolkata)', () => {
    const formatted = formatDateIndia('2026-01-15T20:00:00.000Z')
    expect(formatted).toContain('16')
    expect(formatted).toContain('Jan')
    expect(formatted).toContain('2026')
  })
})

describe('Indian phone and pincode schemas', () => {
  it('normalizes valid Indian mobile numbers to +91XXXXXXXXXX', () => {
    expect(indianPhoneSchema.parse('9876543210')).toBe('+919876543210')
    expect(indianPhoneSchema.parse('+91 98765-43210')).toBe('+919876543210')
    expect(indianPhoneSchema.parse('09876543210')).toBe('+919876543210')
    expect(() => indianPhoneSchema.parse('1234567890')).toThrow()
  })

  it('validates 6-digit Indian pincodes', () => {
    expect(indianPincodeSchema.parse('600001')).toBe('600001')
    expect(() => indianPincodeSchema.parse('012345')).toThrow()
    expect(() => indianPincodeSchema.parse('60001')).toThrow()
  })
})

describe('public stock visibility (computePublicAvailability)', () => {
  it('hides exact count when stock exceeds lowStockThreshold', () => {
    const avail = computePublicAvailability(50, 5, 5)
    expect(avail).toEqual({ inStock: true, lowStock: false })
    expect('availableStock' in avail).toBe(false)
  })

  it('reveals availableStock only when 1 <= available <= lowStockThreshold', () => {
    expect(computePublicAvailability(10, 5, 5)).toEqual({
      inStock: true,
      lowStock: true,
      availableStock: 5,
    })
    expect(computePublicAvailability(3, 0, 5)).toEqual({
      inStock: true,
      lowStock: true,
      availableStock: 3,
    })
  })

  it('returns sold out with no number when available is zero or clamped', () => {
    const zero = computePublicAvailability(5, 5, 5)
    expect(zero).toEqual({ inStock: false, lowStock: false })
    expect('availableStock' in zero).toBe(false)

    const clamped = computePublicAvailability(2, 5, 5)
    expect(clamped).toEqual({ inStock: false, lowStock: false })
  })
})

describe('list query and response strict contract validation', () => {
  it('parses boolean query strings properly and rejects unknown query params', () => {
    expect(productListQuerySchema.parse({ inStockOnly: 'false' }).inStockOnly).toBe(false)
    expect(productListQuerySchema.parse({ inStockOnly: 'true' }).inStockOnly).toBe(true)
    expect(() => productListQuerySchema.parse({ inStockOnly: 'yes' })).toThrow()
    expect(() => productListQuerySchema.parse({ unknownParam: 'x' })).toThrow()
  })

  it('rejects minPricePaise > maxPricePaise and pageSize > 24', () => {
    expect(() =>
      productListQuerySchema.parse({ minPricePaise: '50000', maxPricePaise: '10000' }),
    ).toThrow()
    expect(() => productListQuerySchema.parse({ pageSize: '50' })).toThrow()
  })

  it('rejects leaking internal fields in publicProductSchema and pincodeLookupResponseSchema', () => {
    expect(() =>
      publicProductSchema.parse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        slug: 'groundnut-oil',
        name: 'Groundnut Oil',
        description: 'Cold pressed',
        bestFor: 'Cooking',
        originRegion: 'Pollachi',
        sortOrder: 1,
        brand: '[YOUR BRAND]',
        images: [],
        variants: [],
        currentBatch: null,
        leakedCostPaise: 5000,
      }),
    ).toThrow()

    expect(
      pincodeLookupResponseSchema.parse({
        pincode: '600001',
        serviceable: false,
        city: null,
        state: null,
        deliveryDays: null,
        codAllowed: false,
        shippingPaise: null,
      }).serviceable,
    ).toBe(false)
  })
})

describe('placeholder guards and environment banner', () => {
  it('detects /placeholders/ URLs across relative and absolute forms', () => {
    expect(isPlaceholderUrl('/placeholders/groundnut.svg')).toBe(true)
    expect(isPlaceholderUrl('https://cdn.example.com/placeholders/x.png')).toBe(true)
    expect(isPlaceholderUrl('https://cdn.example.com/products/groundnut.webp')).toBe(false)
  })

  it('blocks /placeholders/ in productionImageUrlSchema', () => {
    expect(() => productionImageUrlSchema.parse('/placeholders/groundnut.svg')).toThrow()
    expect(productionImageUrlSchema.parse('https://cdn.example.com/products/groundnut.webp')).toBe(
      'https://cdn.example.com/products/groundnut.webp',
    )
  })

  it('never shows sample data banner in production even if flag is true', () => {
    expect(
      shouldShowSampleDataBanner({ APP_ENV: 'development', SHOW_SAMPLE_DATA_BANNER: 'true' }),
    ).toBe(true)
    expect(
      shouldShowSampleDataBanner({ APP_ENV: 'staging', SHOW_SAMPLE_DATA_BANNER: 'true' }),
    ).toBe(true)
    expect(
      shouldShowSampleDataBanner({ APP_ENV: 'production', SHOW_SAMPLE_DATA_BANNER: 'true' }),
    ).toBe(false)
    expect(
      shouldShowSampleDataBanner({ VERCEL_ENV: 'production', SHOW_SAMPLE_DATA_BANNER: 'true' }),
    ).toBe(false)
    expect(
      shouldShowSampleDataBanner({ IS_PRODUCTION_DB: 'true', SHOW_SAMPLE_DATA_BANNER: 'true' }),
    ).toBe(false)
  })
})

describe('product activation guard', () => {
  const validProd = {
    images: [{ url: 'https://cdn.example.com/products/groundnut.webp' }],
    variants: [{ isActive: true, pricePaise: 25000, stock: 20 }],
    batches: [{ isActive: true, isCurrent: true }],
  }

  it('allows activating a complete product with real CDN image, price, stock, and current batch', () => {
    expect(canActivateProduct(validProd)).toEqual({ allowed: true, reasons: [] })
  })

  it('refuses activation if image points to /placeholders/', () => {
    const result = canActivateProduct({
      ...validProd,
      images: [{ url: '/placeholders/groundnut.svg' }],
    })
    expect(result.allowed).toBe(false)
    expect(result.reasons[0]).toContain('/placeholders/')
  })

  it('refuses activation when missing price > 0, stock, or active current batch', () => {
    const result = canActivateProduct({
      images: [],
      variants: [{ isActive: true, pricePaise: 0, stock: 0 }],
      batches: [],
    })
    expect(result.allowed).toBe(false)
    expect(result.reasons).toHaveLength(3)
  })
})

describe('order status transitions and checkout validation', () => {
  it('allows valid status transitions and blocks invalid transitions', () => {
    expect(canTransitionOrderStatus(ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAID)).toBe(true)
    expect(canTransitionOrderStatus(ORDER_STATUS.PAID, ORDER_STATUS.CONFIRMED)).toBe(true)
    expect(canTransitionOrderStatus(ORDER_STATUS.PACKED, ORDER_STATUS.SHIPPED)).toBe(true)
    expect(canTransitionOrderStatus(ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.DELIVERED)).toBe(
      false,
    )
    expect(canTransitionOrderStatus(ORDER_STATUS.CANCELLED, ORDER_STATUS.PAID)).toBe(false)
  })

  it('requires DPDP privacy consent on checkout and caps variant qty at 10', () => {
    const base = {
      contact: { name: 'Asha', phone: '9876543210', email: 'asha@example.com' },
      address: {
        name: 'Asha',
        phone: '9876543210',
        line1: '12 Gandhi Road',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
      },
      items: [{ variantId: '550e8400-e29b-41d4-a716-446655440000', qty: 2 }],
      paymentMethod: 'ONLINE',
      dpdpConsent: true,
    }
    expect(checkoutRequestSchema.parse(base).contact.phone).toBe('+919876543210')
    expect(() => checkoutRequestSchema.parse({ ...base, dpdpConsent: false })).toThrow()
    expect(() =>
      checkoutRequestSchema.parse({
        ...base,
        items: [{ variantId: '550e8400-e29b-41d4-a716-446655440000', qty: 11 }],
      }),
    ).toThrow()
  })
})
