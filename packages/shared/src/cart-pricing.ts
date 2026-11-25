import { INDIA_TIMEZONE } from './constants'
import { COUPON_TYPE, type CouponType } from './enums'

export interface CouponComputationInput {
  type: CouponType
  value: number
  minOrderPaise: number
  maxDiscountPaise: number | null
}

export interface FreeShippingWindowConfig {
  enabled: boolean
  thresholdPaise: number
  startsAt: Date | string | null
  endsAt: Date | string | null
}

export interface GstBreakdownResult {
  taxPaise: number
  addedTaxPaise: number
  includedTaxPaise: number
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received: ${value}`)
  }
}

/**
 * Pure integer-paise percentage math with half-up rounding (zero floats):
 * Math.floor((amountPaise * bps + 5000) / 10000).
 */
export function calculatePercentagePaise(amountPaise: number, bps: number): number {
  assertNonNegativeInt(amountPaise, 'amountPaise')
  assertNonNegativeInt(bps, 'bps')
  if (amountPaise === 0 || bps === 0) return 0
  return Math.floor((amountPaise * bps + 5000) / 10000)
}

/**
 * Computes coupon discount in integer paise on the pre-discount item subtotal.
 * Never exceeds itemSubtotalPaise, never discounts shipping, and respects maxDiscountPaise.
 */
export function computeCouponDiscountPaise(
  itemSubtotalPaise: number,
  coupon: CouponComputationInput,
): { eligible: boolean; discountPaise: number } {
  assertNonNegativeInt(itemSubtotalPaise, 'itemSubtotalPaise')
  assertNonNegativeInt(coupon.minOrderPaise, 'minOrderPaise')

  if (itemSubtotalPaise < coupon.minOrderPaise || itemSubtotalPaise === 0) {
    return { eligible: false, discountPaise: 0 }
  }

  let rawDiscount: number
  if (coupon.type === COUPON_TYPE.PERCENT) {
    const bps = coupon.value * 100
    rawDiscount = calculatePercentagePaise(itemSubtotalPaise, bps)
  } else {
    assertNonNegativeInt(coupon.value, 'flatCouponValue')
    rawDiscount = coupon.value
  }

  if (coupon.maxDiscountPaise !== null) {
    assertNonNegativeInt(coupon.maxDiscountPaise, 'maxDiscountPaise')
    rawDiscount = Math.min(rawDiscount, coupon.maxDiscountPaise)
  }

  return {
    eligible: true,
    discountPaise: Math.max(0, Math.min(itemSubtotalPaise, rawDiscount)),
  }
}

/**
 * Allocates an order-level discount across line subtotals proportionally using integer math
 * and the largest-remainder rule so the sum of line discounts equals totalDiscountPaise.
 */
export function allocateProportionalDiscount(
  lineSubtotalsPaise: readonly number[],
  totalDiscountPaise: number,
): number[] {
  assertNonNegativeInt(totalDiscountPaise, 'totalDiscountPaise')
  if (lineSubtotalsPaise.length === 0) return []

  let subtotalSum = 0
  for (const val of lineSubtotalsPaise) {
    assertNonNegativeInt(val, 'lineSubtotalPaise')
    subtotalSum += val
  }

  if (totalDiscountPaise === 0 || subtotalSum === 0) {
    return lineSubtotalsPaise.map(() => 0)
  }

  const target = Math.min(totalDiscountPaise, subtotalSum)
  const totalBig = BigInt(subtotalSum)
  const targetBig = BigInt(target)

  const allocated = lineSubtotalsPaise.map((line) => {
    const product = BigInt(line) * targetBig
    return {
      floor: Number(product / totalBig),
      remainder: product % totalBig,
    }
  })

  const floorSum = allocated.reduce((acc, item) => acc + item.floor, 0)
  let remaining = target - floorSum

  const rankedIndices = allocated
    .map((entry, idx) => ({ idx, remainder: entry.remainder }))
    .sort((a, b) => {
      if (b.remainder > a.remainder) return 1
      if (b.remainder < a.remainder) return -1
      return a.idx - b.idx
    })

  const result = allocated.map((entry) => entry.floor)
  for (let i = 0; i < rankedIndices.length && remaining > 0; i += 1) {
    const targetIdx = rankedIndices[i]!.idx
    if (lineSubtotalsPaise[targetIdx]! > result[targetIdx]!) {
      result[targetIdx]! += 1
      remaining -= 1
    }
  }

  return result
}

/**
 * Computes GST portion strictly in integer paise:
 * - includedInPrice === true: backs tax out via Math.floor((net * rateBps + Math.floor((10000 + rateBps)/2)) / (10000 + rateBps)), addedTaxPaise = 0
 * - includedInPrice === false: adds tax via calculatePercentagePaise(net, rateBps)
 */
export function computeGstBreakdownPaise(
  netItemsTotalPaise: number,
  rateBps: number,
  includedInPrice: boolean,
): GstBreakdownResult {
  assertNonNegativeInt(netItemsTotalPaise, 'netItemsTotalPaise')
  assertNonNegativeInt(rateBps, 'rateBps')

  if (netItemsTotalPaise === 0 || rateBps === 0) {
    return { taxPaise: 0, addedTaxPaise: 0, includedTaxPaise: 0 }
  }

  if (includedInPrice) {
    const denominator = 10000 + rateBps
    const included = Math.floor(
      (netItemsTotalPaise * rateBps + Math.floor(denominator / 2)) / denominator,
    )
    return {
      taxPaise: included,
      addedTaxPaise: 0,
      includedTaxPaise: included,
    }
  }

  const added = calculatePercentagePaise(netItemsTotalPaise, rateBps)
  return {
    taxPaise: added,
    addedTaxPaise: added,
    includedTaxPaise: 0,
  }
}

export function isFreeShippingWindowActive(
  config: FreeShippingWindowConfig,
  now: Date = new Date(),
): boolean {
  if (!config.enabled) return false
  const nowMs = now.getTime()

  if (config.startsAt !== null) {
    const startMs = new Date(config.startsAt).getTime()
    if (Number.isNaN(startMs) || nowMs < startMs) return false
  }
  if (config.endsAt !== null) {
    const endMs = new Date(config.endsAt).getTime()
    if (Number.isNaN(endMs) || nowMs > endMs) return false
  }

  return true
}

/**
 * Checks whether a coupon expiry timestamp is still valid relative to now,
 * treating date-only timestamps safely against India time (Asia/Kolkata).
 */
export function isCouponExpiredIndia(
  expiresAt: Date | string | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false
  const expiryDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  if (Number.isNaN(expiryDate.getTime())) return true
  return expiryDate.getTime() < now.getTime()
}

export function formatPickupReadyEstimateIndia(
  prepTimeMinutes: number,
  now: Date = new Date(),
): string {
  const readyAt = new Date(now.getTime() + Math.max(1, prepTimeMinutes) * 60_000)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIMEZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(readyAt)
}
