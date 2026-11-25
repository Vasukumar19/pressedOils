import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { CART_RATE_LIMITS } from '@pressedoils/shared'
import { ResilientThrottlerStorage } from '../redis/resilient-throttler.storage'
import type { ResolvedCartSession } from './cart-session.service'

const ONE_MINUTE_MS = 60_000
const INVALID_COUPON_WINDOW_MS = CART_RATE_LIMITS.INVALID_COUPON_WINDOW_SECONDS * 1000

/**
 * Dual-layer rate limiting for POST /api/cart/validate backed by Redis with automatic
 * in-memory fallback (never switches off on Redis outage):
 *  - 60 req/min per signed anonymous session (or per IP when unauthenticated/forged)
 *  - 300 req/min ceiling per real client IP (CG-NAT friendly)
 *  - 10 invalid coupon checks / 15 min per IP and per session
 */
@Injectable()
export class CartRateLimitService {
  constructor(private readonly storage: ResilientThrottlerStorage) {}

  async enforceValidateRateLimit(ip: string, session: ResolvedCartSession): Promise<void> {
    const ipCeiling = await this.storage.increment(
      `ip:${ip}`,
      ONE_MINUTE_MS,
      CART_RATE_LIMITS.IP_PER_MIN,
      ONE_MINUTE_MS,
      'cart-validate-ip',
    )
    if (ipCeiling.totalHits > CART_RATE_LIMITS.IP_PER_MIN || ipCeiling.isBlocked) {
      throw new HttpException(
        'Too many cart validation requests. Please slow down.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    // Prevent scrapers from bypassing the 60/min session limit simply by dropping the session header
    const sessionBucketKey = session.isNew ? `anon-ip:${ip}` : `sess:${session.sessionId}`
    const sessionResult = await this.storage.increment(
      sessionBucketKey,
      ONE_MINUTE_MS,
      CART_RATE_LIMITS.SESSION_PER_MIN,
      ONE_MINUTE_MS,
      'cart-validate-session',
    )
    if (sessionResult.totalHits > CART_RATE_LIMITS.SESSION_PER_MIN || sessionResult.isBlocked) {
      throw new HttpException(
        'Too many cart requests in this session. Please wait a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  async assertCouponCheckAllowed(ip: string, sessionId: string): Promise<void> {
    const [ipHits, sessionHits] = await Promise.all([
      this.storage.getCurrentHits(`ip:${ip}`, 'coupon-invalid'),
      this.storage.getCurrentHits(`sess:${sessionId}`, 'coupon-invalid'),
    ])

    if (
      ipHits >= CART_RATE_LIMITS.INVALID_COUPON_LIMIT ||
      sessionHits >= CART_RATE_LIMITS.INVALID_COUPON_LIMIT
    ) {
      throw new HttpException(
        'Too many invalid coupon attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  async recordInvalidCouponAttempt(ip: string, sessionId: string): Promise<void> {
    await Promise.all([
      this.storage.increment(
        `ip:${ip}`,
        INVALID_COUPON_WINDOW_MS,
        CART_RATE_LIMITS.INVALID_COUPON_LIMIT,
        INVALID_COUPON_WINDOW_MS,
        'coupon-invalid',
      ),
      this.storage.increment(
        `sess:${sessionId}`,
        INVALID_COUPON_WINDOW_MS,
        CART_RATE_LIMITS.INVALID_COUPON_LIMIT,
        INVALID_COUPON_WINDOW_MS,
        'coupon-invalid',
      ),
    ])
  }
}
