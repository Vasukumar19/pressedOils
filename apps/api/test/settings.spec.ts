import { describe, expect, it, vi } from 'vitest'
import { SETTING_KEYS } from '@pressedoils/shared'
import { env } from '../src/env'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { RedisService } from '../src/redis/redis.service'
import { SettingsService } from '../src/settings/settings.service'

const LOC_SAMPLE = '550e8400-e29b-41d4-a716-446655440501'
const LOC_REAL = '550e8400-e29b-41d4-a716-446655440502'

describe('SettingsService public hiding & sample pickup protection', () => {
  it('hides freeShippingThresholdPaise when free shipping is disabled and reveals when enabled', async () => {
    const prisma = {
      setting: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              key: SETTING_KEYS.FREE_SHIPPING_CONFIG,
              value: { enabled: false, thresholdPaise: 99900, startsAt: null, endsAt: null },
            },
          ])
          .mockResolvedValueOnce([
            {
              key: SETTING_KEYS.FREE_SHIPPING_CONFIG,
              value: { enabled: true, thresholdPaise: 99900, startsAt: null, endsAt: null },
            },
          ]),
      },
      pickupLocation: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService

    const redis = {
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService

    const svc = new SettingsService(prisma, redis)
    const offRes = await svc.getPublicSettings()
    expect(offRes.freeShippingEnabled).toBe(false)
    expect(offRes.freeShippingThresholdPaise).toBeNull()

    const onRes = await svc.getPublicSettings()
    expect(onRes.freeShippingEnabled).toBe(true)
    expect(onRes.freeShippingThresholdPaise).toBe(99900)
  })

  it('never exposes sample pickup locations in production and hides pickup option when no real active location exists', async () => {
    const prisma = {
      setting: {
        findMany: vi.fn().mockResolvedValue([
          {
            key: SETTING_KEYS.STORE_PICKUP_CONFIG,
            value: { enabled: true, payAtStoreEnabled: false, holdWindowDays: 3 },
          },
        ]),
      },
      pickupLocation: {
        findMany: vi
          .fn()
          .mockImplementation(async ({ where }: { where: { is_sample?: boolean } }) => {
            const all = [
              {
                id: LOC_SAMPLE,
                name: 'SAMPLE STORE',
                address: 'Sample address',
                hours: '10-7',
                prep_time_minutes: 120,
                is_sample: true,
              },
            ]
            return where.is_sample === false ? all.filter((l) => !l.is_sample) : all
          }),
      },
    } as unknown as PrismaService

    const redis = {
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService

    const svc = new SettingsService(prisma, redis)

    // Development exposes seeded sample pickup location when storePickupEnabled is true
    const devRes = await svc.getPublicSettings()
    expect(devRes.storePickupEnabled).toBe(true)
    expect(devRes.pickupLocations).toHaveLength(1)

    // Production refuses sample pickup locations and turns storePickupEnabled off if no real location exists
    const prevEnv = env.APP_ENV
    env.APP_ENV = 'production'
    try {
      const prodRes = await svc.getPublicSettings()
      expect(prodRes.storePickupEnabled).toBe(false)
      expect(prodRes.pickupLocations).toEqual([])
    } finally {
      env.APP_ENV = prevEnv
    }

    // Even if a stale cache entry ever held a sample location, production filter strips it
    const staleCacheRedis = {
      getJson: vi.fn().mockResolvedValue({
        brandName: 'Brand',
        freeShippingEnabledSetting: false,
        freeShippingThresholdPaise: 99900,
        freeShippingStartsAt: null,
        freeShippingEndsAt: null,
        defaultShippingPaise: 7000,
        gstRateBps: 500,
        gstIncludedInPrice: true,
        shippingTaxRateBps: null,
        showTaxBreakdown: false,
        storePickupEnabled: true,
        payAtStoreEnabled: false,
        holdWindowDays: 3,
        fssaiNumber: '123',
        supportEmail: 'a@b.com',
        supportPhone: '+919999999999',
        registeredAddress: 'Chennai',
        requireLabReportForActivation: true,
        pickupLocations: [
          {
            id: LOC_SAMPLE,
            name: 'SAMPLE',
            address: 'X',
            hours: 'Y',
            prepTimeMinutes: 60,
            isSample: true,
          },
          {
            id: LOC_REAL,
            name: 'REAL',
            address: 'R',
            hours: 'Y',
            prepTimeMinutes: 60,
            isSample: false,
          },
        ],
      }),
      setJson: vi.fn(),
    } as unknown as RedisService
    const prodCachedSvc = new SettingsService(prisma, staleCacheRedis)
    env.APP_ENV = 'production'
    try {
      const cachedRes = await prodCachedSvc.getPublicSettings()
      expect(cachedRes.pickupLocations).toHaveLength(1)
      expect(cachedRes.pickupLocations[0]!.id).toBe(LOC_REAL)
    } finally {
      env.APP_ENV = prevEnv
    }
  })
})
