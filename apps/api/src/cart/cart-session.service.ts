import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { env } from '../env'

const DEV_FALLBACK_CART_SECRET = 'dev-only-cart-session-secret-change-me'
const uuidSchema = z.string().uuid()

export interface ResolvedCartSession {
  sessionId: string
  token: string
  isNew: boolean
}

/**
 * Signs and verifies anonymous cart session identifiers via HMAC-SHA256.
 * Used to enforce per-session rate limits separately from CG-NAT shared IP limits.
 */
@Injectable()
export class CartSessionService {
  private getSecret(): string {
    return env.CART_SESSION_SECRET ?? DEV_FALLBACK_CART_SECRET
  }

  signSessionId(sessionId: string): string {
    const sig = createHmac('sha256', this.getSecret()).update(sessionId).digest('base64url')
    return `${sessionId}.${sig}`
  }

  verifyToken(token: string | undefined): string | null {
    if (!token || typeof token !== 'string') return null
    const trimmed = token.trim()
    const parts = trimmed.split('.')
    if (parts.length !== 2) return null

    const [sessionId, providedSig] = parts
    if (!sessionId || !providedSig) return null
    if (!uuidSchema.safeParse(sessionId).success) return null

    const expectedSig = createHmac('sha256', this.getSecret()).update(sessionId).digest('base64url')
    const providedBuf = Buffer.from(providedSig, 'utf8')
    const expectedBuf = Buffer.from(expectedSig, 'utf8')
    if (providedBuf.length !== expectedBuf.length) return null
    if (!timingSafeEqual(providedBuf, expectedBuf)) return null

    return sessionId
  }

  resolveOrCreateSession(tokenHeader: string | undefined): ResolvedCartSession {
    const existingId = this.verifyToken(tokenHeader)
    if (existingId) {
      return {
        sessionId: existingId,
        token: this.signSessionId(existingId),
        isNew: false,
      }
    }

    const sessionId = randomUUID()
    return {
      sessionId,
      token: this.signSessionId(sessionId),
      isNew: true,
    }
  }
}
