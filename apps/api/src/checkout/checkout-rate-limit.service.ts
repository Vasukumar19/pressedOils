import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { CHECKOUT_RATE_LIMITS } from '@pressedoils/shared'
import type { ResolvedCartSession } from '../cart/cart-session.service'
import { ResilientThrottlerStorage } from '../redis/resilient-throttler.storage'

const ONE_MINUTE_MS = 60_000

/**
 * Dedicated rate limiting for checkout placement and payment verification/failure endpoints
 * backed by Redis with automatic in-memory fallback.
 */
@Injectable()
export class CheckoutRateLimitService {
  constructor(private readonly storage: ResilientThrottlerStorage) {}

  async enforceCreateRateLimit(ip: string, session: ResolvedCartSession): Promise<void> {
    const ipRes = await this.storage.increment(
      `ip:${ip}`,
      ONE_MINUTE_MS,
      CHECKOUT_RATE_LIMITS.IP_PER_MIN,
      ONE_MINUTE_MS,
      'checkout-create-ip',
    )
    if (ipRes.totalHits > CHECKOUT_RATE_LIMITS.IP_PER_MIN || ipRes.isBlocked) {
      throw new HttpException(
        'Too many checkout attempts. Please wait a minute and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const sessionBucket = session.isNew ? `anon-ip:${ip}` : `sess:${session.sessionId}`
    const sessRes = await this.storage.increment(
      sessionBucket,
      ONE_MINUTE_MS,
      CHECKOUT_RATE_LIMITS.SESSION_PER_MIN,
      ONE_MINUTE_MS,
      'checkout-create-session',
    )
    if (sessRes.totalHits > CHECKOUT_RATE_LIMITS.SESSION_PER_MIN || sessRes.isBlocked) {
      throw new HttpException(
        'Too many checkout attempts in this session. Please wait a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  async enforceVerifyOrFailRateLimit(ip: string): Promise<void> {
    const res = await this.storage.increment(
      `ip:${ip}`,
      ONE_MINUTE_MS,
      CHECKOUT_RATE_LIMITS.VERIFY_PER_MIN,
      ONE_MINUTE_MS,
      'checkout-verify-ip',
    )
    if (res.totalHits > CHECKOUT_RATE_LIMITS.VERIFY_PER_MIN || res.isBlocked) {
      throw new HttpException(
        'Too many payment confirmation attempts. Please wait a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }
}
