import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id']
  const requestId =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID()

  ;(req as Request & { id?: string }).id = requestId
  res.setHeader('X-Request-Id', requestId)
  next()
}
