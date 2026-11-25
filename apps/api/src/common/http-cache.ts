import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'

export function computeWeakEtag(payload: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)
  return `W/"${hash}"`
}

/**
 * Sets Cache-Control and weak ETag headers on public GET responses,
 * honoring If-None-Match with 304 Not Modified.
 */
export function sendWithHttpCache<T>(
  req: Request,
  res: Response,
  payload: T,
  cacheControl: string,
): T | void {
  const etag = computeWeakEtag(payload)
  res.setHeader('Cache-Control', cacheControl)
  res.setHeader('ETag', etag)

  const ifNoneMatch = req.headers['if-none-match']
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
    res.status(304)
    return
  }

  return payload
}
