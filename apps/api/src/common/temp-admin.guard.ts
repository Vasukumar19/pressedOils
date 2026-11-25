import { timingSafeEqual } from 'node:crypto'
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { isProductionRuntime, TEMP_ADMIN_RATE_LIMITS } from '@pressedoils/shared'
import type { Request } from 'express'
import { env } from '../env'
import { ResilientThrottlerStorage } from '../redis/resilient-throttler.storage'
import { getRealClientIp } from './client-ip'

function isValidSecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Hardened guard for temporary dev/staging admin endpoints (/api/admin/*) until Phase 9 Admin 2FA.
 * - Unconditionally disabled in production (APP_ENV=production or IS_PRODUCTION_DB=true).
 * - Requires ENABLE_TEMP_ADMIN_API=true.
 * - Enforces optional IP allowlist, dedicated strict rate limit, and constant-time secret check.
 */
@Injectable()
export class TempAdminGuard implements CanActivate {
  constructor(private readonly storage: ResilientThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isProd = isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })

    if (isProd || env.ENABLE_TEMP_ADMIN_API !== 'true') {
      throw new ForbiddenException('Temporary admin endpoints are disabled in this environment')
    }

    const req = context.switchToHttp().getRequest<Request>()
    const ip = getRealClientIp(req)

    const rateRes = await this.storage.increment(
      `ip:${ip}`,
      60_000,
      TEMP_ADMIN_RATE_LIMITS.IP_PER_MIN,
      60_000,
      'temp-admin-ip',
    )
    if (rateRes.totalHits > TEMP_ADMIN_RATE_LIMITS.IP_PER_MIN || rateRes.isBlocked) {
      throw new HttpException('Too many admin requests', HttpStatus.TOO_MANY_REQUESTS)
    }

    if (env.TEMP_ADMIN_IP_ALLOWLIST.length > 0) {
      const normalizedAllowed = env.TEMP_ADMIN_IP_ALLOWLIST.map((x) => x.replace(/^::ffff:/, ''))
      if (!normalizedAllowed.includes(ip)) {
        throw new ForbiddenException('Client IP is not on the admin allowlist')
      }
    }

    if (!env.OWNER_SETTINGS_SECRET) {
      throw new ServiceUnavailableException('Temporary admin secret is not configured')
    }

    const secretHeader = req.headers['x-admin-secret']
    const provided = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader
    if (!isValidSecret(provided, env.OWNER_SETTINGS_SECRET)) {
      throw new ForbiddenException('Invalid admin credentials')
    }

    return true
  }
}
