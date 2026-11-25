import { timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Env } from '../env'
import { getRealClientIp } from './client-ip'

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Protects Swagger UI in staging via IP allowlist and/or HTTP Basic Auth.
 * In production, Swagger UI is never mounted at all.
 */
export function createDocsAuthMiddleware(
  env: Pick<Env, 'APP_ENV' | 'SWAGGER_USER' | 'SWAGGER_PASSWORD' | 'SWAGGER_IP_ALLOWLIST'>,
) {
  return function docsAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (env.APP_ENV === 'development') {
      next()
      return
    }

    if (env.APP_ENV === 'production') {
      res.status(404).end()
      return
    }

    // Staging: allow if IP is in explicit allowlist
    const clientIp = getRealClientIp(req)
    if (env.SWAGGER_IP_ALLOWLIST.length > 0 && env.SWAGGER_IP_ALLOWLIST.includes(clientIp)) {
      next()
      return
    }

    // Otherwise require Basic Auth when configured
    if (env.SWAGGER_USER && env.SWAGGER_PASSWORD) {
      const header = req.headers.authorization
      if (header?.startsWith('Basic ')) {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
        const sep = decoded.indexOf(':')
        if (sep !== -1) {
          const user = decoded.slice(0, sep)
          const pass = decoded.slice(sep + 1)
          if (safeEqual(user, env.SWAGGER_USER) && safeEqual(pass, env.SWAGGER_PASSWORD)) {
            next()
            return
          }
        }
      }
      res.setHeader('WWW-Authenticate', 'Basic realm="Staging API Docs"')
      res.status(401).json({ statusCode: 401, message: 'Authentication required for staging docs' })
      return
    }

    res.status(403).json({ statusCode: 403, message: 'Forbidden' })
  }
}
