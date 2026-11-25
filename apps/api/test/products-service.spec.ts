import { describe, expect, it, vi } from 'vitest'
import { publicProductListResponseSchema } from '@pressedoils/shared'
import { env } from '../src/env'
import { ProductCacheService } from '../src/products/products.cache'
import { ProductsService } from '../src/products/products.service'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { RedisService } from '../src/redis/redis.service'

const SAMPLE_ID = '550e8400-e29b-41d4-a716-446655440001'
const SAMPLE_IMG_ID = '550e8400-e29b-41d4-a716-446655440002'
const SAMPLE_VAR_HIGH_ID = '550e8400-e29b-41d4-a716-446655440003'
const SAMPLE_VAR_LOW_ID = '550e8400-e29b-41d4-a716-446655440004'

function createSampleDbProducts(imageUrl: string) {
  return [
    {
      id: SAMPLE_ID,
      slug: 'groundnut-oil',
      name: 'Groundnut Oil',
      description: 'Cold-pressed groundnut oil',
      best_for: 'Everyday cooking',
      origin_region: 'Pollachi',
      sort_order: 1,
      brand: '[YOUR BRAND]',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      // Extra internal fields simulating accidental exposure — mapper must strip them
      internal_cost_paise: 5000,
      images: [
        {
          id: SAMPLE_IMG_ID,
          url: imageUrl,
          alt: 'Groundnut oil bottle',
          sort_order: 0,
        },
      ],
      variants: [
        {
          id: SAMPLE_VAR_HIGH_ID,
          sku: 'GND-500ML',
          size_label: '500 ml',
          price_paise: 25000,
          mrp_paise: 30000,
        },
        {
          id: SAMPLE_VAR_LOW_ID,
          sku: 'GND-1L',
          size_label: '1 L',
          price_paise: 48000,
          mrp_paise: 55000,
        },
      ],
      batches: [
        {
          batch_no: 'GND-2026-01',
          pressed_on: new Date('2026-01-15'),
          best_before: new Date('2026-10-15'),
          lab_report_url: 'https://cdn.example.com/reports/gnd-01.pdf',
          lab_tested_on: new Date('2026-01-18'),
        },
      ],
    },
  ]
}

describe('ProductsService security, field whitelist & Redis fallback', () => {
  it('whitelists exact response keys, hides raw stock/reserved, and falls back to PostgreSQL when Redis is down', async () => {
    const prisma = {
      product: {
        findMany: vi
          .fn()
          .mockResolvedValue(createSampleDbProducts('https://cdn.example.com/p/gnd.webp')),
      },
      variant: {
        findMany: vi.fn().mockResolvedValue([
          { id: SAMPLE_VAR_HIGH_ID, stock: 50, reserved: 2, low_stock_threshold: 5 },
          { id: SAMPLE_VAR_LOW_ID, stock: 5, reserved: 2, low_stock_threshold: 5 },
        ]),
      },
    } as unknown as PrismaService

    const redisDown = {
      getString: vi.fn().mockResolvedValue(null),
      setString: vi.fn().mockResolvedValue(undefined),
      setStringNx: vi.fn().mockResolvedValue(false),
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn().mockResolvedValue(undefined),
      incrKey: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService

    const cache = new ProductCacheService(redisDown)
    const service = new ProductsService(prisma, cache)

    const response = await service.list({ sort: 'featured', page: 1, pageSize: 12 })

    // Strict Zod response contract check (fails if ANY unwhitelisted field leaks)
    const parsed = publicProductListResponseSchema.parse(response)
    expect(parsed.items).toHaveLength(1)

    const product = parsed.items[0]!
    expect(Object.keys(product).sort()).toEqual([
      'bestFor',
      'brand',
      'currentBatch',
      'description',
      'id',
      'images',
      'name',
      'originRegion',
      'slug',
      'sortOrder',
      'variants',
    ])

    // High-stock variant does NOT expose availableStock or stock/reserved
    const highVar = product.variants.find((v) => v.id === SAMPLE_VAR_HIGH_ID)!
    expect(Object.keys(highVar).sort()).toEqual([
      'id',
      'inStock',
      'lowStock',
      'mrpPaise',
      'pricePaise',
      'sizeLabel',
      'sku',
    ])
    expect(highVar.inStock).toBe(true)
    expect(highVar.lowStock).toBe(false)

    // Low-stock variant exposes ONLY availableStock (= 3) alongside standard fields
    const lowVar = product.variants.find((v) => v.id === SAMPLE_VAR_LOW_ID)!
    expect(Object.keys(lowVar).sort()).toEqual([
      'availableStock',
      'id',
      'inStock',
      'lowStock',
      'mrpPaise',
      'pricePaise',
      'sizeLabel',
      'sku',
    ])
    expect(lowVar.availableStock).toBe(3)
  })

  it('excludes products referencing /placeholders/ in production without throwing 500', async () => {
    const prisma = {
      product: {
        findMany: vi.fn().mockResolvedValue(createSampleDbProducts('/placeholders/groundnut.svg')),
      },
      variant: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService

    const redis = {
      getString: vi.fn().mockResolvedValue('1'),
      setString: vi.fn(),
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn(),
    } as unknown as RedisService

    const service = new ProductsService(prisma, new ProductCacheService(redis))

    const prevAppEnv = env.APP_ENV
    env.APP_ENV = 'production'
    try {
      const list = await service.list({ sort: 'featured', page: 1, pageSize: 12 })
      expect(list.items).toHaveLength(0)
      await expect(service.getBySlug('groundnut-oil')).rejects.toThrow(/not found/)
    } finally {
      env.APP_ENV = prevAppEnv
    }
  })

  it('strips untrusted labReportUrl in production and retains trusted CDN report URLs', async () => {
    const prisma = {
      product: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce(createSampleDbProducts('https://cdn.example.com/p/gnd.webp'))
          .mockResolvedValueOnce([
            {
              ...createSampleDbProducts('https://cdn.example.com/p/gnd.webp')[0]!,
              batches: [
                {
                  batch_no: 'GND-2026-01',
                  pressed_on: new Date('2026-01-15'),
                  best_before: new Date('2026-10-15'),
                  lab_report_url: 'https://untrusted.example.org/report.pdf',
                  lab_tested_on: new Date('2026-01-18'),
                },
              ],
            },
          ]),
      },
      variant: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService

    const redis = {
      getString: vi.fn().mockResolvedValue('1'),
      setString: vi.fn(),
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn(),
    } as unknown as RedisService

    const service = new ProductsService(prisma, new ProductCacheService(redis))
    const prevAppEnv = env.APP_ENV
    const prevAllowed = env.CDN_ALLOWED_HOSTS
    env.APP_ENV = 'production'
    env.CDN_ALLOWED_HOSTS = ['cdn.example.com']

    try {
      const trusted = await service.getBySlug('groundnut-oil')
      expect(trusted.currentBatch?.labReportUrl).toBe('https://cdn.example.com/reports/gnd-01.pdf')

      const untrusted = await service.getBySlug('groundnut-oil')
      expect(untrusted.currentBatch?.labReportUrl).toBeNull()
      expect(untrusted.currentBatch?.labTestedOn).toBeNull()
      expect(untrusted.currentBatch?.labTestedOnDisplay).toBeNull()
    } finally {
      env.APP_ENV = prevAppEnv
      env.CDN_ALLOWED_HOSTS = prevAllowed
    }
  })
})
