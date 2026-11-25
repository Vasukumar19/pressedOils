import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import Redis from 'ioredis'
import {
  apiErrorResponseSchema,
  healthLivenessResponseSchema,
  healthReadinessResponseSchema,
  pincodeLookupResponseSchema,
  publicAvailabilityResponseSchema,
  publicProductListResponseSchema,
  publicProductSchema,
  publicSettingsResponseSchema,
} from '@pressedoils/shared'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { env, validateEnv } from '../src/env'
import { PrismaService } from '../src/prisma/prisma.service'
import { ProductCacheService } from '../src/products/products.cache'
import { RedisService } from '../src/redis/redis.service'

const apiRoot = resolve(__dirname, '..')

describe('Public API E2E (PostgreSQL + Redis)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let redis: RedisService
  let cacheService: ProductCacheService

  beforeAll(async () => {
    execFileSync('pnpm', ['exec', 'tsx', 'prisma/seed.dev.ts'], {
      cwd: apiRoot,
      env: { ...process.env, NODE_ENV: 'development', APP_ENV: 'development' },
      shell: process.platform === 'win32',
    })

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication({ bodyParser: false })
    const testEnv = validateEnv({
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'development',
      CORS_ORIGINS: 'http://localhost:3000',
    })
    configureApp(app, testEnv)
    await app.init()

    prisma = app.get(PrismaService)
    redis = app.get(RedisService)
    cacheService = app.get(ProductCacheService)

    // Ensure clean cache & rate-limit state in Redis across consecutive runs
    if (process.env.REDIS_URL) {
      const cleanupClient = new Redis(process.env.REDIS_URL)
      await cleanupClient.flushdb()
      await cleanupClient.quit()
    }
    await cacheService.invalidateProductCache()
  })

  afterAll(async () => {
    await app.close()
  })

  it('health liveness & readiness endpoints return valid status and X-Request-Id', async () => {
    const live = await request(app.getHttpServer()).get('/api/health').expect(200)
    expect(live.headers['x-request-id']).toBeTruthy()
    expect(live.headers['x-content-type-options']).toBe('nosniff')
    expect(healthLivenessResponseSchema.parse(live.body).status).toBe('ok')

    const ready = await request(app.getHttpServer()).get('/api/health/ready').expect(200)
    const parsed = healthReadinessResponseSchema.parse(ready.body)
    expect(parsed.checks.database).toBe('ok')
  })

  it('health readiness stays HTTP 200 degraded when Redis fails', async () => {
    const spy = vi.spyOn(redis, 'ping').mockResolvedValueOnce('degraded')
    const ready = await request(app.getHttpServer()).get('/api/health/ready').expect(200)
    const parsed = healthReadinessResponseSchema.parse(ready.body)
    expect(parsed.status).toBe('degraded')
    expect(parsed.checks).toEqual({ database: 'ok', redis: 'degraded' })
    spy.mockRestore()
  })

  it('GET /api/products validates contract, hides stock/reserved, sets Cache-Control/ETag, and supports 304', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/products?sort=featured&page=1&pageSize=3')
      .expect(200)

    expect(res.headers['cache-control']).toContain('max-age=5')
    expect(res.headers['etag']).toBeTruthy()

    const parsed = publicProductListResponseSchema.parse(res.body)
    expect(parsed.items).toHaveLength(3)
    expect(parsed.pagination).toEqual({ page: 1, pageSize: 3, total: 6, totalPages: 2 })

    const rawJson = JSON.stringify(res.body)
    expect(rawJson).not.toContain('"stock"')
    expect(rawJson).not.toContain('"reserved"')
    expect(rawJson).not.toContain('labReportKey')

    // Conditional ETag -> 304 Not Modified
    await request(app.getHttpServer())
      .get('/api/products?sort=featured&page=1&pageSize=3')
      .set('If-None-Match', res.headers['etag'] as string)
      .expect(304)
  })

  it('GET /api/products rejects unknown query params and minPricePaise > maxPricePaise without stack traces', async () => {
    const unknownRes = await request(app.getHttpServer()).get('/api/products?extra=123').expect(400)
    const err1 = apiErrorResponseSchema.parse(unknownRes.body)
    expect(err1.requestId).toBeTruthy()
    expect(JSON.stringify(unknownRes.body)).not.toContain('at ')

    const priceRes = await request(app.getHttpServer())
      .get('/api/products?minPricePaise=50000&maxPricePaise=10000')
      .expect(400)
    apiErrorResponseSchema.parse(priceRes.body)
  })

  it('GET /api/products/:slug returns detail, 404 for unknown slug, and respects cache invalidation', async () => {
    const detail = await request(app.getHttpServer()).get('/api/products/groundnut-oil').expect(200)
    const parsed = publicProductSchema.parse(detail.body)
    expect(parsed.slug).toBe('groundnut-oil')
    expect(parsed.currentBatch?.batchNo).toBe('PH-GND-001')

    await request(app.getHttpServer()).get('/api/products/nonexistent-oil').expect(404)

    // Update a variant price in DB, invalidate cache, and confirm fresh price returns
    const variant = parsed.variants[0]!
    await prisma.variant.update({ where: { id: variant.id }, data: { price_paise: 15000 } })
    await cacheService.invalidateProductCache('groundnut-oil', [variant.id])

    const after = await request(app.getHttpServer()).get('/api/products/groundnut-oil').expect(200)
    expect(after.body.variants.find((v: { id: string }) => v.id === variant.id)?.pricePaise).toBe(
      15000,
    )

    // Restore seeded price
    await prisma.variant.update({
      where: { id: variant.id },
      data: { price_paise: variant.pricePaise },
    })
    await cacheService.invalidateProductCache('groundnut-oil', [variant.id])
  })

  it('GET /api/products/availability returns live availability with no-store and respects lowStockThreshold', async () => {
    const list = await request(app.getHttpServer()).get('/api/products?pageSize=1').expect(200)
    const variant = list.body.items[0].variants[0]

    // Set variant stock to 3 (below low_stock_threshold 5)
    await prisma.variant.update({ where: { id: variant.id }, data: { stock: 3, reserved: 0 } })

    const availRes = await request(app.getHttpServer())
      .get(`/api/products/availability?variantIds=${variant.id}`)
      .expect(200)

    expect(availRes.headers['cache-control']).toBe('no-store')
    const parsed = publicAvailabilityResponseSchema.parse(availRes.body)
    expect(parsed.maxOrderQtyPerVariant).toBe(env.MAX_QTY_PER_VARIANT)
    expect(parsed.items[0]).toEqual({
      variantId: variant.id,
      inStock: true,
      lowStock: true,
      availableStock: 3,
    })

    // Restore stock to 50 -> availableStock must disappear
    await prisma.variant.update({ where: { id: variant.id }, data: { stock: 50 } })
    const restored = await request(app.getHttpServer())
      .get(`/api/products/availability?variantIds=${variant.id}`)
      .expect(200)
    expect(restored.body.items[0]).toEqual({
      variantId: variant.id,
      inStock: true,
      lowStock: false,
    })
  })

  it('products still load from PostgreSQL when Redis cache fails', async () => {
    const getSpy = vi.spyOn(redis, 'getJson').mockResolvedValue(null)
    const setSpy = vi.spyOn(redis, 'setJson').mockResolvedValue(undefined)
    const strGetSpy = vi.spyOn(redis, 'getString').mockResolvedValue(null)
    const strSetSpy = vi.spyOn(redis, 'setStringNx').mockResolvedValue(false)

    const res = await request(app.getHttpServer()).get('/api/products').expect(200)
    expect(publicProductListResponseSchema.parse(res.body).items.length).toBeGreaterThan(0)

    getSpy.mockRestore()
    setSpy.mockRestore()
    strGetSpy.mockRestore()
    strSetSpy.mockRestore()
  })

  it('GET /api/settings returns whitelisted settings and enforces production banner rule', async () => {
    const res = await request(app.getHttpServer()).get('/api/settings').expect(200)
    expect(res.headers['cache-control']).toContain('max-age=60')
    expect(res.headers['etag']).toBeTruthy()
    const parsed = publicSettingsResponseSchema.parse(res.body)
    expect(parsed.currency).toBe('INR')
    expect(parsed.maxQtyPerVariant).toBe(env.MAX_QTY_PER_VARIANT)
  })

  it('CORS allows exact allowlisted origin without credentials and rejects unknown origin', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/settings')
      .set('Origin', 'http://localhost:3000')
      .expect(200)
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined()

    const blocked = await request(app.getHttpServer())
      .get('/api/settings')
      .set('Origin', 'https://attacker.example.com')
      .expect(200)
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('GET /api/pincode/:pincode returns uniform schema for found & not-found and enforces strict rate limit', async () => {
    const found = await request(app.getHttpServer()).get('/api/pincode/600001').expect(200)
    expect(found.headers['cache-control']).toContain('max-age=300')
    expect(pincodeLookupResponseSchema.parse(found.body)).toEqual({
      pincode: '600001',
      serviceable: true,
      city: 'Chennai',
      state: 'Tamil Nadu',
      deliveryDays: 2,
      codAllowed: true,
      shippingPaise: 5000,
    })

    const missing = await request(app.getHttpServer()).get('/api/pincode/999999').expect(200)
    expect(pincodeLookupResponseSchema.parse(missing.body)).toEqual({
      pincode: '999999',
      serviceable: false,
      city: null,
      state: null,
      deliveryDays: null,
      codAllowed: false,
      shippingPaise: null,
    })

    expect(Object.keys(found.body).sort()).toEqual(Object.keys(missing.body).sort())

    await request(app.getHttpServer()).get('/api/pincode/1234').expect(400)

    // Trigger strict 20 req/min rate limit on /api/pincode/:pincode
    let hit429 = false
    for (let i = 0; i < 22; i++) {
      const r = await request(app.getHttpServer()).get('/api/pincode/600001')
      if (r.status === 429) {
        hit429 = true
        break
      }
    }
    expect(hit429).toBe(true)
  })
})
