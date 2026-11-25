import { describe, expect, it, vi } from 'vitest'
import { HealthController } from '../src/health/health.controller'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { RedisService } from '../src/redis/redis.service'

function mockRes() {
  let code = 200
  return {
    status: vi.fn((c: number) => {
      code = c
    }),
    getCode: () => code,
  }
}

describe('HealthController', () => {
  it('checkLiveness returns status ok without touching dependencies', () => {
    const controller = new HealthController({} as PrismaService, {} as RedisService)
    const result = controller.checkLiveness()
    expect(result.status).toBe('ok')
    expect(typeof result.timestamp).toBe('string')
    expect(typeof result.uptime).toBe('number')
  })

  it('checkReadiness returns 200 ok when Postgres and Redis are healthy', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([1]) } as unknown as PrismaService
    const redis = { ping: vi.fn().mockResolvedValue('ok') } as unknown as RedisService
    const controller = new HealthController(prisma, redis)
    const res = mockRes()

    const body = await controller.checkReadiness(res as never)
    expect(res.getCode()).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.checks).toEqual({ database: 'ok', redis: 'ok' })
  })

  it('checkReadiness returns 200 degraded when Redis is down but Postgres is healthy', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([1]) } as unknown as PrismaService
    const redis = { ping: vi.fn().mockResolvedValue('degraded') } as unknown as RedisService
    const controller = new HealthController(prisma, redis)
    const res = mockRes()

    const body = await controller.checkReadiness(res as never)
    expect(res.getCode()).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks).toEqual({ database: 'ok', redis: 'degraded' })
  })

  it('checkReadiness returns 503 down when Postgres is unreachable', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('DB connection refused')),
    } as unknown as PrismaService
    const redis = { ping: vi.fn().mockResolvedValue('ok') } as unknown as RedisService
    const controller = new HealthController(prisma, redis)
    const res = mockRes()

    const body = await controller.checkReadiness(res as never)
    expect(res.getCode()).toBe(503)
    expect(body.status).toBe('down')
    expect(body.checks).toEqual({ database: 'down', redis: 'ok' })
  })
})
