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
        codEnabled: false,
        codFeePaise: 0,
        codMaxOrderPaise: 500000,
        maxActiveCodOrdersPerPhone: 2,
        legalPagesApproved: false,
        dpdpPolicyVersion: '2026-11-draft-v1',
        autoConfirmPaidOrders: true,
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
      expect(cachedRes.checkoutEnabled).toBe(false)
      expect(cachedRes.legalPagesApproved).toBe(false)
      expect(cachedRes.codEnabled).toBe(false)
      expect(cachedRes.codMaxOrderPaise).toBeNull()
    } finally {
      env.APP_ENV = prevEnv
    }
  })

  it('disables checkout in production while legalPagesApproved is false and enables once approved', async () => {
    const prisma = {
      setting: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              key: SETTING_KEYS.LEGAL_PAGES_CONFIG,
              value: { approved: false, privacyVersion: '2026-11-draft-v1' },
            },
          ])
          .mockResolvedValueOnce([
            {
              key: SETTING_KEYS.LEGAL_PAGES_CONFIG,
              value: { approved: true, privacyVersion: '2026-11-v1' },
            },
          ]),
      },
      pickupLocation: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService

    const redis = {
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService

    const svc = new SettingsService(prisma, redis)
    const prevAppEnv = env.APP_ENV
    env.APP_ENV = 'production'
    try {
      const blocked = await svc.getPublicSettings()
      expect(blocked.legalPagesApproved).toBe(false)
      expect(blocked.checkoutEnabled).toBe(false)

      const approved = await svc.getPublicSettings()
      expect(approved.legalPagesApproved).toBe(true)
      expect(approved.checkoutEnabled).toBe(true)
      expect(approved.dpdpPolicyVersion).toBe('2026-11-v1')
    } finally {
      env.APP_ENV = prevAppEnv
    }
  })

  it('gates COD and Pay-at-Store behind smsOtpReady in production and allows when MSG91 OTP DLT is configured', async () => {
    const prisma = {
      setting: {
        findMany: vi.fn().mockResolvedValue([
          {
            key: SETTING_KEYS.STORE_PICKUP_CONFIG,
            value: { enabled: true, payAtStoreEnabled: true, holdWindowDays: 3 },
          },
          {
            key: SETTING_KEYS.COD_CONFIG,
            value: {
              enabled: true,
              feePaise: 0,
              maxOrderPaise: 500000,
              maxActiveOrdersPerPhone: 2,
            },
          },
        ]),
      },
      pickupLocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: LOC_REAL,
            name: 'Flagship Store',
            address: 'MG Road',
            hours: '9-8',
            prep_time_minutes: 60,
            is_sample: false,
          },
        ]),
      },
    } as unknown as PrismaService

    const redis = {
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisService

    const svc = new SettingsService(prisma, redis)
    const prevAppEnv = env.APP_ENV
    const prevSmsProvider = env.SMS_PROVIDER
    const prevAuthKey = env.MSG91_AUTH_KEY
    const prevSenderId = env.MSG91_SENDER_ID
    const prevOtpTpl = env.MSG91_DLT_TEMPLATE_OTP

    try {
      // Dev mode with mock SMS allows COD & Pay-at-store when enabled in settings
      env.APP_ENV = 'development'
      env.SMS_PROVIDER = 'mock'
      const devSettings = await svc.getPublicSettings()
      expect(devSettings.smsOtpReady).toBe(true)
      expect(devSettings.codEnabled).toBe(true)
      expect(devSettings.payAtStoreEnabled).toBe(true)

      // Production with incomplete MSG91 config forces smsOtpReady/COD/Pay-at-Store false
      env.APP_ENV = 'production'
      env.SMS_PROVIDER = 'mock'
      const prodUnready = await svc.getPublicSettings()
      expect(prodUnready.smsOtpReady).toBe(false)
      expect(prodUnready.codEnabled).toBe(false)
      expect(prodUnready.payAtStoreEnabled).toBe(false)

      // Production with MSG91 + OTP template ready re-enables COD & Pay-at-Store
      env.SMS_PROVIDER = 'msg91'
      env.MSG91_AUTH_KEY = 'msg91-key'
      env.MSG91_SENDER_ID = 'PRSOIL'
      env.MSG91_DLT_TEMPLATE_OTP = 'dlt-otp-123'
      const prodReady = await svc.getPublicSettings()
      expect(prodReady.smsOtpReady).toBe(true)
      expect(prodReady.codEnabled).toBe(true)
      expect(prodReady.payAtStoreEnabled).toBe(true)
    } finally {
      env.APP_ENV = prevAppEnv
      env.SMS_PROVIDER = prevSmsProvider
      env.MSG91_AUTH_KEY = prevAuthKey
      env.MSG91_SENDER_ID = prevSenderId
      env.MSG91_DLT_TEMPLATE_OTP = prevOtpTpl
    }
  })
})
