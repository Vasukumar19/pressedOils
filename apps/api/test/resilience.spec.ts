import { describe, expect, it, vi } from 'vitest'
import { CircuitBreaker } from '../src/common/circuit-breaker'
import { getRealClientIp } from '../src/common/client-ip'
import { SingleFlight, withJitter } from '../src/common/single-flight'
import { createDocsAuthMiddleware } from '../src/common/swagger-auth'
import { ResilientThrottlerStorage } from '../src/redis/resilient-throttler.storage'
import type { RedisService } from '../src/redis/redis.service'

describe('CircuitBreaker', () => {
  it('opens after threshold failures and recovers via HALF_OPEN after cooldown', () => {
    let clock = 1000
    const transitions: string[] = []
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 5000,
      now: () => clock,
      onStateChange: (from, to) => transitions.push(`${from}->${to}`),
    })

    expect(breaker.isExecutionAllowed()).toBe(true)
    breaker.recordFailure('t1')
    breaker.recordFailure('t2')
    expect(breaker.getState()).toBe('CLOSED')

    breaker.recordFailure('t3')
    expect(breaker.getState()).toBe('OPEN')
    expect(breaker.isExecutionAllowed()).toBe(false)

    clock += 5000
    expect(breaker.getState()).toBe('HALF_OPEN')
    expect(breaker.isExecutionAllowed()).toBe(true)

    breaker.recordSuccess()
    expect(breaker.getState()).toBe('CLOSED')
    expect(transitions).toEqual(['CLOSED->OPEN', 'OPEN->HALF_OPEN', 'HALF_OPEN->CLOSED'])
  })
})

describe('SingleFlight and withJitter', () => {
  it('deduplicates concurrent cache-stampede rebuilds into a single loader call', async () => {
    const sf = new SingleFlight()
    let calls = 0

    const loader = async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 20))
      return { ok: true, calls }
    }

    const results = await Promise.all(
      Array.from({ length: 15 }, () => sf.run('catalog:all', loader)),
    )

    expect(calls).toBe(1)
    expect(results.every((r) => r.calls === 1)).toBe(true)
    expect(sf.size()).toBe(0)
  })

  it('bounds TTL jitter within expected range and at least 1s', () => {
    expect(withJitter(300, 0.2, () => 0)).toBe(240)
    expect(withJitter(300, 0.2, () => 1)).toBe(360)
    expect(withJitter(1, 0.5, () => 0)).toBeGreaterThanOrEqual(1)
  })
})

describe('ResilientThrottlerStorage', () => {
  it('falls back to in-memory limiting when Redis fails so limiting never switches off', async () => {
    const redisDown = {
      incrRateLimit: vi.fn().mockResolvedValue(null),
    } as unknown as RedisService

    const storage = new ResilientThrottlerStorage(redisDown)
    const r1 = await storage.increment('1.2.3.4', 60_000, 2, 60_000, 'default')
    const r2 = await storage.increment('1.2.3.4', 60_000, 2, 60_000, 'default')
    const r3 = await storage.increment('1.2.3.4', 60_000, 2, 60_000, 'default')

    expect(r1.totalHits).toBe(1)
    expect(r1.isBlocked).toBe(false)
    expect(r2.totalHits).toBe(2)
    expect(r2.isBlocked).toBe(false)
    expect(r3.totalHits).toBe(3)
    expect(r3.isBlocked).toBe(true)
  })
})

describe('getRealClientIp', () => {
  it('uses Express-resolved req.ip and strips IPv4-mapped IPv6 prefix', () => {
    expect(getRealClientIp({ ip: '::ffff:203.0.113.9', socket: {} as never })).toBe('203.0.113.9')
  })
})

describe('createDocsAuthMiddleware', () => {
  function runMiddleware(
    env: Parameters<typeof createDocsAuthMiddleware>[0],
    opts: { ip?: string; auth?: string } = {},
  ) {
    const mw = createDocsAuthMiddleware(env)
    let nextCalled = false
    let statusCode = 200
    const headers: Record<string, string> = {}
    const req = { ip: opts.ip ?? '10.0.0.5', headers: { authorization: opts.auth } } as never
    const res = {
      status: vi.fn((c: number) => {
        statusCode = c
        return res
      }),
      setHeader: vi.fn((k: string, v: string) => {
        headers[k] = v
      }),
      json: vi.fn(),
      end: vi.fn(),
    } as never

    mw(req, res, () => {
      nextCalled = true
    })
    return { nextCalled, statusCode, headers }
  }

  it('blocks in production, allows in development, and requires auth or IP in staging', () => {
    expect(
      runMiddleware({
        APP_ENV: 'production',
        SWAGGER_IP_ALLOWLIST: [],
      }).statusCode,
    ).toBe(404)

    expect(
      runMiddleware({
        APP_ENV: 'development',
        SWAGGER_IP_ALLOWLIST: [],
      }).nextCalled,
    ).toBe(true)

    const stagingDenied = runMiddleware({
      APP_ENV: 'staging',
      SWAGGER_USER: 'ops',
      SWAGGER_PASSWORD: 'secret-password',
      SWAGGER_IP_ALLOWLIST: ['198.51.100.10'],
    })
    expect(stagingDenied.statusCode).toBe(401)
    expect(stagingDenied.headers['WWW-Authenticate']).toContain('Basic')

    const basicHeader = `Basic ${Buffer.from('ops:secret-password').toString('base64')}`
    expect(
      runMiddleware(
        {
          APP_ENV: 'staging',
          SWAGGER_USER: 'ops',
          SWAGGER_PASSWORD: 'secret-password',
          SWAGGER_IP_ALLOWLIST: [],
        },
        { auth: basicHeader },
      ).nextCalled,
    ).toBe(true)

    expect(
      runMiddleware(
        {
          APP_ENV: 'staging',
          SWAGGER_IP_ALLOWLIST: ['198.51.100.10'],
        },
        { ip: '198.51.100.10' },
      ).nextCalled,
    ).toBe(true)
  })
})
