import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import {
  type CheckoutRequest,
  getIndiaDateYYMMDD,
  ORDER_NUMBER_ALPHABET,
} from '@pressedoils/shared'
import { env } from '../env'

const DEV_PICKUP_HMAC_FALLBACK = 'dev-only-pickup-code-hmac-secret-do-not-use-in-prod'

@Injectable()
export class CheckoutSecurityService {
  private getPickupHmacSecret(): string {
    return env.PICKUP_CODE_HMAC_SECRET ?? DEV_PICKUP_HMAC_FALLBACK
  }

  /**
   * Generates a non-sequential customer order number: ORD-YYMMDD-XXXXX
   * using Asia/Kolkata date and an unambiguous 32-character alphabet (no 0/O/1/I).
   */
  generateOrderNumber(now: Date = new Date()): string {
    const datePart = getIndiaDateYYMMDD(now)
    let suffix = ''
    for (let i = 0; i < 5; i += 1) {
      const idx = randomInt(0, ORDER_NUMBER_ALPHABET.length)
      suffix += ORDER_NUMBER_ALPHABET[idx]!
    }
    return `ORD-${datePart}-${suffix}`
  }

  /**
   * Generates a 6-digit pickup verification code and its server-keyed HMAC-SHA256 digest.
   * Never store or log the plaintext 6-digit code in DB or analytics.
   */
  createPickupCodePair(orderId: string): { plaintextCode: string; hmacHash: string } {
    const plaintextCode = String(randomInt(100000, 1000000))
    const hmacHash = this.hashPickupCode(orderId, plaintextCode)
    return { plaintextCode, hmacHash }
  }

  hashPickupCode(orderId: string, code: string): string {
    return createHmac('sha256', this.getPickupHmacSecret())
      .update(`${orderId}:${code.trim()}`)
      .digest('hex')
  }

  verifyPickupCode(orderId: string, candidateCode: string, storedHmacHash: string): boolean {
    if (!/^\d{6}$/.test(candidateCode.trim())) return false
    const expected = this.hashPickupCode(orderId, candidateCode)
    if (expected.length !== storedHmacHash.length) return false
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(storedHmacHash, 'utf8'))
  }

  /**
   * Canonical SHA-256 request fingerprint so Idempotency-Key detects mismatched payload tampering.
   */
  computeCheckoutRequestHash(dto: CheckoutRequest): string {
    const mergedItems = new Map<string, number>()
    for (const item of dto.items) {
      mergedItems.set(item.variantId, (mergedItems.get(item.variantId) ?? 0) + item.qty)
    }
    const canonicalItems = Array.from(mergedItems.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([variantId, qty]) => ({ variantId, qty }))

    const canonicalPayload = {
      contact: {
        name: dto.contact.name.trim(),
        phone: dto.contact.phone,
        email: dto.contact.email?.trim().toLowerCase() ?? null,
      },
      fulfilmentMethod: dto.fulfilmentMethod,
      address: dto.address
        ? {
            name: dto.address.name.trim(),
            phone: dto.address.phone,
            line1: dto.address.line1.trim(),
            line2: dto.address.line2?.trim() ?? null,
            city: dto.address.city.trim(),
            state: dto.address.state.trim(),
            pincode: dto.address.pincode,
          }
        : null,
      pickupLocationId: dto.pickupLocationId ?? null,
      items: canonicalItems,
      paymentMethod: dto.paymentMethod,
      couponCode: dto.couponCode?.trim().toUpperCase() ?? null,
      dpdpConsent: dto.dpdpConsent,
      marketingConsent: dto.marketingConsent,
    }

    return createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex')
  }
}
