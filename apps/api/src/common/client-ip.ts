import type { Request } from 'express'

/**
 * Extracts the client IP from Express's req.ip (which respects the configured
 * `trust proxy` setting and ignores untrusted X-Forwarded-For headers).
 */
export function getRealClientIp(req: Pick<Request, 'ip' | 'socket'>): string {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown'
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw
}
