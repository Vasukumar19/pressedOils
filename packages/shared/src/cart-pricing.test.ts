import { describe, expect, it } from 'vitest'
import {
  allocateProportionalDiscount,
  calculatePercentagePaise,
  canTransitionOrderStatus,
  computeCouponDiscountPaise,
  computeGstBreakdownPaise,
  COUPON_TYPE,
  FULFILMENT_METHOD,
  isCouponExpiredIndia,
  isFreeShippingWindowActive,
  ORDER_STATUS,
} from './index'

describe('Phase 4 integer-paise cart pricing math', () => {
  it('computes percentage paise using pure integer math (half-up) with zero float drift', () => {
    expect(calculatePercentagePaise(10000, 1000)).toBe(1000)
    expect(calculatePercentagePaise(105, 500)).toBe(5)
    // 1005 * 500 = 502500 -> +5000 = 507500 -> floor(/10000) = 50; 1010 * 500 = 505000 -> +5000 = 510000 -> 51
    expect(calculatePercentagePaise(1005, 500)).toBe(50)
    expect(calculatePercentagePaise(1010, 500)).toBe(51)
  })

  it('enforces coupon minOrderPaise before discount, maxDiscountPaise cap, and never produces negative total', () => {
    const percentCapped = {
      type: COUPON_TYPE.PERCENT,
      value: 20,
      minOrderPaise: 30000,
      maxDiscountPaise: 10000,
    }
    expect(computeCouponDiscountPaise(29999, percentCapped)).toEqual({
      eligible: false,
      discountPaise: 0,
    })
    expect(computeCouponDiscountPaise(30000, percentCapped)).toEqual({
      eligible: true,
      discountPaise: 6000,
    })
    expect(computeCouponDiscountPaise(100000, percentCapped)).toEqual({
      eligible: true,
      discountPaise: 10000,
    })

    const flatExcessive = {
      type: COUPON_TYPE.FLAT,
      value: 50000,
      minOrderPaise: 0,
      maxDiscountPaise: null,
    }
    expect(computeCouponDiscountPaise(20000, flatExcessive)).toEqual({
      eligible: true,
      discountPaise: 20000,
    })
  })

  it('allocates order-level discounts proportionally using largest-remainder so line sums match exactly', () => {
    // 3 equal lines of 10000 paise sharing 1000 paise discount -> 334, 333, 333
    const equal = allocateProportionalDiscount([10000, 10000, 10000], 1000)
    expect(equal).toEqual([334, 333, 333])
    expect(equal.reduce((a, b) => a + b, 0)).toBe(1000)

    // Uneven lines
    const uneven = allocateProportionalDiscount([15001, 25003, 9999], 3777)
    expect(uneven.reduce((a, b) => a + b, 0)).toBe(3777)
    for (let i = 0; i < uneven.length; i += 1) {
      expect(uneven[i]).toBeGreaterThanOrEqual(0)
      expect(uneven[i]).toBeLessThanOrEqual([15001, 25003, 9999][i]!)
    }
  })

  it('computes GST portion correctly for both inclusive and exclusive modes', () => {
    // Inclusive 5% GST inside 10500 paise -> tax = 500
    expect(computeGstBreakdownPaise(10500, 500, true)).toEqual({
      taxPaise: 500,
      addedTaxPaise: 0,
      includedTaxPaise: 500,
    })

    // Exclusive 5% GST on 10000 paise -> addedTax = 500
    expect(computeGstBreakdownPaise(10000, 500, false)).toEqual({
      taxPaise: 500,
      addedTaxPaise: 500,
      includedTaxPaise: 0,
    })
  })

  it('evaluates free-shipping schedule window & India-timezone coupon expiry properly', () => {
    const now = new Date('2026-11-25T10:00:00.000Z')
    expect(
      isFreeShippingWindowActive(
        {
          enabled: true,
          thresholdPaise: 99900,
          startsAt: '2026-11-25T00:00:00+05:30',
          endsAt: '2026-11-26T23:59:59+05:30',
        },
        now,
      ),
    ).toBe(true)
    expect(
      isFreeShippingWindowActive(
        {
          enabled: false,
          thresholdPaise: 99900,
          startsAt: null,
          endsAt: null,
        },
        now,
      ),
    ).toBe(false)

    // Expired 1 second before now in IST
    expect(isCouponExpiredIndia('2026-11-25T15:29:59+05:30', now)).toBe(true)
    expect(isCouponExpiredIndia('2026-11-25T15:30:01+05:30', now)).toBe(false)
  })

  it('supports pickup order status transitions alongside delivery transitions', () => {
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.PACKED,
        ORDER_STATUS.READY_FOR_PICKUP,
        FULFILMENT_METHOD.STORE_PICKUP,
      ),
    ).toBe(true)
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.READY_FOR_PICKUP,
        ORDER_STATUS.PICKED_UP,
        FULFILMENT_METHOD.STORE_PICKUP,
      ),
    ).toBe(true)
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.PACKED,
        ORDER_STATUS.SHIPPED,
        FULFILMENT_METHOD.STORE_PICKUP,
      ),
    ).toBe(false)
    expect(
      canTransitionOrderStatus(
        ORDER_STATUS.PACKED,
        ORDER_STATUS.READY_FOR_PICKUP,
        FULFILMENT_METHOD.DELIVERY,
      ),
    ).toBe(false)
  })
})
