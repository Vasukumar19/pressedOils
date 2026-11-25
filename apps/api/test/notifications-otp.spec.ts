import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALERT_GROUP_WINDOW_SECONDS, ALERT_SEVERITY, NOTIFICATION_EVENT } from '@pressedoils/shared'
import { env } from '../src/env'
import {
  hashEmailForSuppression,
  hashPhoneForOtp,
  maskEmail,
  maskPhone,
} from '../src/notifications/notification.types'
import {
  buildCustomerNotificationTemplate,
  buildOtpSmsTemplate,
  buildOwnerAlertTemplate,
} from '../src/notifications/templates/notification-templates'
import {
  MockEmailTransport,
  MockSmsTransport,
} from '../src/notifications/transports/mock-transports'
import { ResendEmailTransport } from '../src/notifications/transports/resend-email.transport'
import { OpsAlertService } from '../src/queue/ops-alert.service'
import type { QueueService } from '../src/queue/queue.service'
import type { RedisService } from '../src/redis/redis.service'

describe('Phase 7 notifications, Svix, PII masking, mock prod refusal & OpsAlertService', () => {
  const originalEnvSnapshot = {
    APP_ENV: env.APP_ENV,
    IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    SENTRY_DSN: env.SENTRY_DSN,
    UPTIME_ALERT_WEBHOOK_URL: env.UPTIME_ALERT_WEBHOOK_URL,
  }

  afterEach(() => {
    env.APP_ENV = originalEnvSnapshot.APP_ENV
    env.IS_PRODUCTION_DB = originalEnvSnapshot.IS_PRODUCTION_DB
    env.SENTRY_DSN = originalEnvSnapshot.SENTRY_DSN
    env.UPTIME_ALERT_WEBHOOK_URL = originalEnvSnapshot.UPTIME_ALERT_WEBHOOK_URL
    vi.restoreAllMocks()
  })

  it('masks Indian mobile numbers and email addresses safely for logs and UI', () => {
    expect(maskPhone('+919876543210')).toBe('+91******3210')
    expect(maskPhone('9876543210')).toBe('******3210')
    expect(maskPhone('9876')).toBe('****')

    expect(maskEmail('ananya.rao@example.com')).toBe('a*****o@example.com')
    expect(maskEmail('ab@example.com')).toBe('a*@example.com')
    expect(maskEmail('a@example.com')).toBe('*@example.com')
    expect(maskEmail('invalid')).toBe('***')
  })

  it('produces keyed deterministic HMAC hashes for email suppression & OTP phones', () => {
    const h1 = hashEmailForSuppression('  Customer@Example.COM ', 'secret-a')
    const h2 = hashEmailForSuppression('customer@example.com', 'secret-a')
    const h3 = hashEmailForSuppression('customer@example.com', 'secret-b')
    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
    expect(h1).toHaveLength(64)

    const p1 = hashPhoneForOtp('+919876543210', 'secret-a')
    const p2 = hashPhoneForOtp(' +919876543210 ', 'secret-a')
    const p3 = hashPhoneForOtp('+919876543210', 'secret-b')
    expect(p1).toBe(p2)
    expect(p1).not.toBe(p3)
  })

  it('verifies Resend Svix webhook signatures strictly over exact raw body bytes & rejects tampering/expiry', () => {
    const rawSecretBytes = Buffer.from('test-resend-svix-key-12345', 'utf8')
    const svixSecret = `whsec_${rawSecretBytes.toString('base64')}`
    const svixId = 'msg_test_001'
    const nowTs = String(Math.floor(Date.now() / 1000))
    const rawBody = Buffer.from('{"type":"email.delivered","data":{"email_id":"re_123"}}', 'utf8')
    const sigDigest = createHmac('sha256', rawSecretBytes)
      .update(`${svixId}.${nowTs}.${rawBody.toString('utf8')}`)
      .digest('base64')

    expect(
      ResendEmailTransport.verifySvixSignature({
        rawBody,
        svixId,
        svixTimestamp: nowTs,
        svixSignature: `v1,${sigDigest}`,
        secret: svixSecret,
      }),
    ).toBe(true)

    // Tampered body fails constant-time check
    expect(
      ResendEmailTransport.verifySvixSignature({
        rawBody: Buffer.from('{"type":"email.delivered","data":{"email_id":"re_999"}}', 'utf8'),
        svixId,
        svixTimestamp: nowTs,
        svixSignature: `v1,${sigDigest}`,
        secret: svixSecret,
      }),
    ).toBe(false)

    // Expired timestamp (> 300s tolerance) fails
    const staleTs = String(Math.floor(Date.now() / 1000) - 600)
    const staleDigest = createHmac('sha256', rawSecretBytes)
      .update(`${svixId}.${staleTs}.${rawBody.toString('utf8')}`)
      .digest('base64')
    expect(
      ResendEmailTransport.verifySvixSignature({
        rawBody,
        svixId,
        svixTimestamp: staleTs,
        svixSignature: `v1,${staleDigest}`,
        secret: svixSecret,
      }),
    ).toBe(false)
  })

  it('refuses to instantiate MockEmailTransport or MockSmsTransport in production runtime', () => {
    env.APP_ENV = 'production'
    expect(() => new MockEmailTransport()).toThrow(/cannot be instantiated in production/i)
    expect(() => new MockSmsTransport()).toThrow(/cannot be instantiated in production/i)

    env.APP_ENV = 'staging'
    env.IS_PRODUCTION_DB = 'true'
    expect(() => new MockEmailTransport()).toThrow(/cannot be instantiated in production/i)
    expect(() => new MockSmsTransport()).toThrow(/cannot be instantiated in production/i)
  })

  it('renders versioned branded customer templates and zero-PII owner alerts', () => {
    const readyTpl = buildCustomerNotificationTemplate({
      event: NOTIFICATION_EVENT.ORDER_READY_FOR_PICKUP,
      brandName: '[YOUR BRAND] <script>',
      supportEmail: 'care@example.com',
      supportPhone: '+919999999999',
      orderNumber: 'ORD-261125-ABCDE',
      pickupLocationName: 'Flagship Oil Mill',
      pickupAddress: '12 Mill Rd, Chennai',
      pickupHours: '10 AM – 7 PM',
      pickupCode: '482910',
      lastCollectionDate: '28 Nov 2026',
    })
    expect(readyTpl.templateVersion).toBe('v1')
    expect(readyTpl.dltTemplateKey).toBe('ORDER_READY_FOR_PICKUP')
    expect(readyTpl.smsBody).toContain('482910')
    expect(readyTpl.smsBody).toContain('28 Nov 2026')
    expect(readyTpl.emailHtml).toContain('482910')
    expect(readyTpl.emailHtml).toContain('10 AM – 7 PM')
    expect(readyTpl.emailHtml).not.toContain('<script>')

    const shippedTpl = buildCustomerNotificationTemplate({
      event: NOTIFICATION_EVENT.ORDER_SHIPPED,
      brandName: '[YOUR BRAND]',
      supportEmail: 'care@example.com',
      supportPhone: '+919999999999',
      orderNumber: 'ORD-261125-SHIP1',
      trackingUrl: 'https://track.example.com/awb/12345',
    })
    expect(shippedTpl.dltTemplateKey).toBe('ORDER_SHIPPED')
    expect(shippedTpl.smsBody).toContain('https://track.example.com/awb/12345')

    const otpTpl = buildOtpSmsTemplate({
      brandName: '[YOUR BRAND]',
      code: '739104',
      ttlMinutes: 5,
      purposeLabel: 'COD verification',
    })
    expect(otpTpl.templateVersion).toBe('v1')
    expect(otpTpl.smsBody).toContain('739104')

    const alertTpl = buildOwnerAlertTemplate({
      brandName: '[YOUR BRAND]',
      alertKey: 'payment-amount-currency-mismatch',
      severity: ALERT_SEVERITY.CRITICAL,
      orderNumber: 'ORD-261125-MISM1',
      reason: 'Paid amount mismatch requires operator review',
      occurrenceCount: 4,
      supportEmail: 'care@example.com',
      supportPhone: '+919999999999',
    })
    expect(alertTpl.emailSubject).toContain('[CRITICAL]')
    expect(alertTpl.emailSubject).toContain('ORD-261125-MISM1')
    expect(alertTpl.smsBody).toContain('(repeated 4x)')
    expect(alertTpl.emailHtml).toContain('no customer personal data')
  })

  it('routes INFO/WARNING/CRITICAL severities, groups repeated alerts within 15m, and detects 5m webhook/payment spikes', async () => {
    env.SENTRY_DSN = 'https://publickey@sentry.example.com/42'
    env.UPTIME_ALERT_WEBHOOK_URL = 'https://uptime.example.com/hook'

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const store = new Map<string, string>()
    const redis = {
      setStringNx: vi.fn(async (key: string, val: string) => {
        if (store.has(key)) return false
        store.set(key, val)
        return true
      }),
      getString: vi.fn(async (key: string) => store.get(key) ?? null),
      del: vi.fn(async (key: string) => {
        store.delete(key)
      }),
      incrKey: vi.fn(async (key: string) => {
        const next = Number(store.get(key) ?? '0') + 1
        store.set(key, String(next))
        return next
      }),
    } as unknown as RedisService

    const queueService = {
      enqueueOpsAlert: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueueService

    const ops = new OpsAlertService(queueService, redis)

    // 1. INFO -> log only (no queue, no Sentry, no uptime)
    const infoOut = await ops.alertCritical({
      alertKey: 'info-test',
      severity: ALERT_SEVERITY.INFO,
      message: 'Informational event',
    })
    expect(infoOut.dispatched).toBe(false)
    expect(queueService.enqueueOpsAlert).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()

    // 2. WARNING -> queue + Sentry, NO external uptime webhook
    const warnOut = await ops.alertCritical({
      alertKey: 'warn-test',
      severity: ALERT_SEVERITY.WARNING,
      orderNumber: 'ORD-261125-WARN1',
      message: 'Warning condition',
    })
    expect(warnOut).toEqual({
      dispatched: true,
      throttled: false,
      occurrenceCount: 1,
      severity: ALERT_SEVERITY.WARNING,
    })
    expect(queueService.enqueueOpsAlert).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('sentry.example.com')

    // 3. Repeated identical alert within 15m window throttles & accumulates repetition count
    const warnThrottled1 = await ops.alertCritical({
      alertKey: 'warn-test',
      severity: ALERT_SEVERITY.WARNING,
      message: 'Warning condition repeated',
    })
    const warnThrottled2 = await ops.alertCritical({
      alertKey: 'warn-test',
      severity: ALERT_SEVERITY.WARNING,
      message: 'Warning condition repeated again',
    })
    expect(warnThrottled1.throttled).toBe(true)
    expect(warnThrottled2.throttled).toBe(true)
    expect(redis.setStringNx).toHaveBeenCalledWith(
      'ops:alert:gate:warn-test',
      '1',
      ALERT_GROUP_WINDOW_SECONDS,
    )

    // Simulate 15m gate expiring: next alert includes occurrenceCount = 3 (1 + 2 suppressed)
    store.delete('ops:alert:gate:warn-test')
    const afterWindowOut = await ops.alertCritical({
      alertKey: 'warn-test',
      severity: ALERT_SEVERITY.WARNING,
      message: 'Warning still active',
    })
    expect(afterWindowOut.dispatched).toBe(true)
    expect(afterWindowOut.occurrenceCount).toBe(3)

    // 4. CRITICAL -> queue + Sentry + external uptime webhook
    fetchSpy.mockClear()
    const critOut = await ops.alertCritical({
      alertKey: 'crit-test',
      severity: ALERT_SEVERITY.CRITICAL,
      orderNumber: 'ORD-261125-CRIT1',
      message: 'Critical outage',
    })
    expect(critOut.dispatched).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('sentry.example.com'),
        'https://uptime.example.com/hook',
      ]),
    )

    // 5. Spike detection fires only at >= 10 hits in 5m window
    const alertSpy = vi.spyOn(ops, 'alertCritical')
    for (let i = 0; i < 9; i += 1) {
      await ops.recordInvalidWebhookSignature()
    }
    expect(alertSpy).not.toHaveBeenCalled()
    await ops.recordInvalidWebhookSignature()
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKey: 'webhook-invalid-signature-spike',
        severity: ALERT_SEVERITY.CRITICAL,
      }),
    )

    alertSpy.mockClear()
    for (let i = 0; i < 9; i += 1) {
      await ops.recordPaymentFailedWebhook()
    }
    expect(alertSpy).not.toHaveBeenCalled()
    await ops.recordPaymentFailedWebhook()
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKey: 'payment-failed-spike',
        severity: ALERT_SEVERITY.WARNING,
      }),
    )
  })
})
