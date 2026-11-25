import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  adminOrderTransitionResponseSchema,
  adminTestAlertResponseSchema,
  checkoutResponseSchema,
  NOTIFICATION_EVENT,
  OTP_PURPOSE,
  pickupCodeReissueResponseSchema,
} from '@pressedoils/shared'
import Redis from 'ioredis'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { CheckoutService } from '../src/checkout/checkout.service'
import { PaymentGatewayService } from '../src/checkout/payment-gateway.service'
import { env, validateEnv } from '../src/env'
import { EMAIL_TRANSPORT, SMS_TRANSPORT } from '../src/notifications/notification.types'
import { NotificationsService } from '../src/notifications/notifications.service'
import type {
  MockEmailTransport,
  MockSmsTransport,
} from '../src/notifications/transports/mock-transports'
import { TurnstileService } from '../src/otp/turnstile.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { ProductCacheService } from '../src/products/products.cache'
import {
  type CustomerNotificationJobPayload,
  type OpsAlertJobPayload,
  QueueService,
} from '../src/queue/queue.service'
import { SettingsService } from '../src/settings/settings.service'

const apiRoot = resolve(__dirname, '..')
const ADMIN_SECRET = 'phase7-temp-admin-secret-123456'
const ADMIN_EMAIL = 'phase7-owner@pressedoils.test'

describe('Phase 7 Notifications, OTP Gate, Pickup Rotation & Owner Alerts (integration)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let checkoutService: CheckoutService
  let paymentGateway: PaymentGatewayService
  let queueService: QueueService
  let notificationsService: NotificationsService
  let settingsService: SettingsService
  let cacheService: ProductCacheService
  let mockEmail: MockEmailTransport
  let mockSms: MockSmsTransport
  let variant1LId: string
  let variant500mlId: string
  let pickupLocationId: string
  let enqueuedNotifications: CustomerNotificationJobPayload[] = []
  let enqueuedAlerts: OpsAlertJobPayload[] = []

  const origOwnerEmail = env.OWNER_ALERT_EMAIL
  const origOwnerPhone = env.OWNER_ALERT_PHONE
  const origLowBalance = env.SMS_LOW_BALANCE_THRESHOLD

  async function cleanAllState() {
    await prisma.checkoutIdempotencyKey.deleteMany()
    await prisma.webhookEvent.deleteMany()
    await prisma.notificationLog.deleteMany()
    await prisma.emailSuppression.deleteMany()
    await prisma.otpChallenge.deleteMany()
    await prisma.phoneVerificationToken.deleteMany()
    await prisma.refund.deleteMany()
    await prisma.auditLog.deleteMany()
    await prisma.orderEvent.deleteMany()
    await prisma.reservation.deleteMany()
    await prisma.stockMovement.deleteMany({ where: { order_id: { not: null } } })
    await prisma.payment.deleteMany()
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    await prisma.address.deleteMany()
    await prisma.customer.deleteMany()
    await prisma.variant.updateMany({ data: { stock: 50, reserved: 0 } })
    await prisma.coupon.update({
      where: { code: 'SAMPLE10' },
      data: { used_count: 0, usage_limit: 100, is_active: true },
    })
  }

  async function resetRedisAndMocks() {
    enqueuedNotifications = []
    enqueuedAlerts = []
    mockEmail.clear()
    mockSms.clear()
    if (process.env.REDIS_URL) {
      const r = new Redis(process.env.REDIS_URL)
      await r.flushdb()
      await r.quit()
    }
    if (process.env.QUEUE_REDIS_URL) {
      const q = new Redis(process.env.QUEUE_REDIS_URL)
      await q.flushdb()
      await q.quit()
    }
    await cacheService.invalidateProductCache()
    await settingsService.invalidateCache()
  }

  async function sendAndVerifyOtp(input: {
    phone: string
    purpose: 'COD_CHECKOUT' | 'ORDER_TRACKING' | 'PICKUP_CODE_REISSUE'
    sessionToken?: string
    turnstileToken?: string
  }) {
    const sendReq = request(app.getHttpServer()).post('/api/otp/send')
    if (input.sessionToken) {
      sendReq.set('x-cart-session', input.sessionToken)
    }
    const sendRes = await sendReq
      .send({
        phone: input.phone,
        purpose: input.purpose,
        ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}),
      })
      .expect(200)

    const resolvedSession = sendRes.headers['x-cart-session'] as string
    const lastSms = mockSms.outbox[mockSms.outbox.length - 1]
    const otpMatch = lastSms?.textBody.match(/\b(\d{6})\b/)
    if (!otpMatch) {
      throw new Error(`Missing 6-digit OTP in SMS: ${lastSms?.textBody}`)
    }

    const verifyRes = await request(app.getHttpServer())
      .post('/api/otp/verify')
      .set('x-cart-session', resolvedSession)
      .send({
        challengeId: sendRes.body.challengeId,
        phone: input.phone,
        code: otpMatch[1],
        purpose: input.purpose,
      })
      .expect(200)

    return {
      challengeId: sendRes.body.challengeId as string,
      otpCode: otpMatch[1]!,
      verificationToken: verifyRes.body.verificationToken as string,
      sessionToken: verifyRes.headers['x-cart-session'] as string,
    }
  }

  async function drainQueuedNotifications() {
    const batch = enqueuedNotifications.splice(0, enqueuedNotifications.length)
    for (const job of batch) {
      await notificationsService.deliverCustomerNotification(job)
    }
    return batch
  }

  async function drainQueuedAlerts() {
    const batch = enqueuedAlerts.splice(0, enqueuedAlerts.length)
    for (const alert of batch) {
      await notificationsService.dispatchOwnerAlertDelivery(alert)
    }
    return batch
  }

  beforeAll(async () => {
    execFileSync('pnpm', ['exec', 'tsx', 'prisma/seed.dev.ts'], {
      cwd: apiRoot,
      env: { ...process.env, NODE_ENV: 'development', APP_ENV: 'development' },
      shell: process.platform === 'win32',
    })

    env.APP_ENV = 'development'
    env.ENABLE_TEMP_ADMIN_API = 'true'
    env.OWNER_SETTINGS_SECRET = ADMIN_SECRET
    env.PAYMENT_GATEWAY = 'mock'
    env.SMS_PROVIDER = 'mock'
    env.EMAIL_PROVIDER = 'mock'
    env.OWNER_ALERT_EMAIL = ['owner@pressedoils.test', 'ops@pressedoils.test']
    env.OWNER_ALERT_PHONE = ['+919876500001']
    env.SMS_LOW_BALANCE_THRESHOLD = 500

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication({ bodyParser: false })
    const testEnv = validateEnv({
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'development',
      ENABLE_TEMP_ADMIN_API: 'true',
      OWNER_SETTINGS_SECRET: ADMIN_SECRET,
      PAYMENT_GATEWAY: 'mock',
      SMS_PROVIDER: 'mock',
      EMAIL_PROVIDER: 'mock',
      CORS_ORIGINS: 'http://localhost:3000',
    })
    configureApp(app, testEnv)
    await app.init()

    prisma = app.get(PrismaService)
    checkoutService = app.get(CheckoutService)
    paymentGateway = app.get(PaymentGatewayService)
    queueService = app.get(QueueService)
    notificationsService = app.get(NotificationsService)
    settingsService = app.get(SettingsService)
    cacheService = app.get(ProductCacheService)
    mockEmail = app.get<MockEmailTransport>(EMAIL_TRANSPORT)
    mockSms = app.get<MockSmsTransport>(SMS_TRANSPORT)

    await prisma.admin.upsert({
      where: { email: ADMIN_EMAIL },
      update: { role: 'OWNER', is_active: true },
      create: {
        email: ADMIN_EMAIL,
        role: 'OWNER',
        is_active: true,
        must_set_password: true,
      },
    })

    vi.spyOn(queueService, 'enqueueCustomerNotification').mockImplementation(async (payload) => {
      enqueuedNotifications.push(payload)
    })
    vi.spyOn(queueService, 'enqueueOpsAlert').mockImplementation(async (payload) => {
      enqueuedAlerts.push(payload)
    })

    const list = await request(app.getHttpServer()).get('/api/products?pageSize=6').expect(200)
    variant1LId = list.body.items[0].variants.find(
      (v: { sizeLabel: string }) => v.sizeLabel === '1 L',
    ).id
    variant500mlId = list.body.items[0].variants.find(
      (v: { sizeLabel: string }) => v.sizeLabel === '500 ml',
    ).id

    const settingsRes = await request(app.getHttpServer()).get('/api/settings').expect(200)
    pickupLocationId = settingsRes.body.pickupLocations[0].id
  })

  beforeEach(async () => {
    await cleanAllState()
    await resetRedisAndMocks()
  })

  afterAll(async () => {
    env.OWNER_ALERT_EMAIL = origOwnerEmail
    env.OWNER_ALERT_PHONE = origOwnerPhone
    env.SMS_LOW_BALANCE_THRESHOLD = origLowBalance
    vi.restoreAllMocks()
    await cleanAllState()
    await resetRedisAndMocks()
    await prisma.admin.deleteMany({ where: { email: ADMIN_EMAIL } })
    await app.close()
  })

  it('sends exactly one SMS + Email per order status transition & never duplicates on replay or partial-channel retry', async () => {
    const otp = await sendAndVerifyOtp({ phone: '9876501010', purpose: 'COD_CHECKOUT' })
    mockSms.clear()

    // 1. COD placement -> ORDER_PLACED_COD
    const codCreate = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('x-cart-session', otp.sessionToken)
      .set('Idempotency-Key', `p7-lifecycle-cod-${Date.now()}`)
      .send({
        contact: { name: 'Kavya', phone: '9876501010', email: 'kavya@example.com' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Kavya',
          phone: '9876501010',
          line1: '10 Anna Nagar',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant1LId, qty: 2 }],
        paymentMethod: 'COD',
        phoneVerificationToken: otp.verificationToken,
        dpdpConsent: true,
      })
      .expect(201)
    const codOrder = checkoutResponseSchema.parse(codCreate.body).order

    let batch = await drainQueuedNotifications()
    expect(batch.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_PLACED_COD])
    expect(mockSms.outbox).toHaveLength(1)
    expect(mockEmail.outbox).toHaveLength(1)

    // Repeat delivery & partial channel retry: SMS succeeds, Email fails once -> retry sends ONLY Email once
    await notificationsService.deliverCustomerNotification(batch[0]!)
    expect(mockSms.outbox).toHaveLength(1)
    expect(mockEmail.outbox).toHaveLength(1)

    // 2. Confirm -> PACKED (with email transient failure on first attempt) -> SHIPPED -> DELIVERED
    await request(app.getHttpServer())
      .post(`/api/admin/orders/${codOrder.id}/confirm`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ reason: 'Verified COD customer' })
      .expect(200)
    await drainQueuedNotifications()
    expect(mockSms.outbox).toHaveLength(2)
    expect(mockEmail.outbox).toHaveLength(2)

    await request(app.getHttpServer())
      .post(`/api/admin/orders/${codOrder.id}/pack`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ note: 'Packed tin bottles' })
      .expect(200)

    const packJob = enqueuedNotifications.shift()!
    expect(packJob.event).toBe(NOTIFICATION_EVENT.ORDER_PACKED)
    mockEmail.setFailNext(true)
    await expect(notificationsService.deliverCustomerNotification(packJob)).rejects.toThrow()
    // SMS succeeded (3), Email failed (still 2)
    expect(mockSms.outbox).toHaveLength(3)
    expect(mockEmail.outbox).toHaveLength(2)
    // Retry same job -> SMS NOT re-sent, Email delivered ONCE (3)
    await notificationsService.deliverCustomerNotification(packJob)
    expect(mockSms.outbox).toHaveLength(3)
    expect(mockEmail.outbox).toHaveLength(3)

    const shipRes = await request(app.getHttpServer())
      .post(`/api/admin/orders/${codOrder.id}/ship`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ trackingUrl: 'https://track.example.com/awb/AWB9988' })
      .expect(200)
    expect(adminOrderTransitionResponseSchema.parse(shipRes.body).orderStatus).toBe('SHIPPED')
    batch = await drainQueuedNotifications()
    expect(batch.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_SHIPPED])
    expect(mockSms.outbox[mockSms.outbox.length - 1]!.textBody).toContain('AWB9988')
    expect(mockEmail.outbox[mockEmail.outbox.length - 1]!.html).toContain('AWB9988')

    await request(app.getHttpServer())
      .post(`/api/admin/orders/${codOrder.id}/deliver`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send()
      .expect(200)
    batch = await drainQueuedNotifications()
    expect(batch.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_DELIVERED])

    // Verify 10 SENT notification rows (5 lifecycle events x 2 channels) & masked logs (zero raw PII)
    const codLogs = await prisma.notificationLog.findMany({ where: { order_id: codOrder.id } })
    expect(codLogs).toHaveLength(10)
    expect(codLogs.every((l) => l.status === 'SENT')).toBe(true)
    expect(codLogs.some((l) => l.masked_recipient === '+91******1010')).toBe(true)
    expect(codLogs.some((l) => l.masked_recipient.includes('k***a@example.com'))).toBe(true)

    // 3. Online PAID -> partial refund -> full refund -> notifications queued & sent once per event
    const onlineCreate = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', `p7-online-ref-${Date.now()}`)
      .send({
        contact: { name: 'Rohan', phone: '9876502020', email: 'rohan@example.com' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Rohan',
          phone: '9876502020',
          line1: '18 Besant Nagar',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant1LId, qty: 2 }],
        paymentMethod: 'ONLINE',
        dpdpConsent: true,
      })
      .expect(201)
    const onlineOrder = checkoutResponseSchema.parse(onlineCreate.body)
    const sigPayload = paymentGateway.createMockSignedPayment(
      onlineOrder.payment!.gatewayOrderId,
      'pay_p7_online_01',
    )
    await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({ orderId: onlineOrder.order.id, ...sigPayload })
      .expect(200)
    batch = await drainQueuedNotifications()
    expect(batch.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_CONFIRMED])

    // Partial refund followed by remaining refund via admin endpoint + refund.processed webhooks
    const partRefRes = await request(app.getHttpServer())
      .post(`/api/admin/orders/${onlineOrder.order.id}/refund`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .set('idempotency-key', `p7-part-ref-${Date.now()}`)
      .send({ amountPaise: 10000, reason: 'Broken bottle' })
      .expect(200)
    const partialHook = JSON.stringify({
      id: `evt_p7_part_${Date.now()}`,
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: partRefRes.body.gatewayRefundId,
            payment_id: 'pay_p7_online_01',
            amount: 10000,
          },
        },
      },
    })
    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set(
        'x-razorpay-signature',
        paymentGateway.createMockWebhookSignature(Buffer.from(partialHook)),
      )
      .set('Content-Type', 'application/json')
      .send(partialHook)
      .expect(200)
    batch = await drainQueuedNotifications()
    expect(batch.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_PARTIALLY_REFUNDED])

    // Remaining refund completes FULL refund -> ORDER_REFUNDED
    const remainingPaise = onlineOrder.order.totalPaise - 10000
    const fullRefRes = await request(app.getHttpServer())
      .post(`/api/admin/orders/${onlineOrder.order.id}/refund`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .set('idempotency-key', `p7-full-ref-${Date.now()}`)
      .send({ amountPaise: remainingPaise, reason: 'Remaining balance refunded' })
      .expect(200)
    const fullHook = JSON.stringify({
      id: `evt_p7_full_${Date.now()}`,
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: fullRefRes.body.gatewayRefundId,
            payment_id: 'pay_p7_online_01',
            amount: remainingPaise,
          },
        },
      },
    })
    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('x-razorpay-signature', paymentGateway.createMockWebhookSignature(Buffer.from(fullHook)))
      .set('Content-Type', 'application/json')
      .send(fullHook)
      .expect(200)
    batch = await drainQueuedNotifications()
    expect(batch.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_REFUNDED])

    // 4. Online Cancel -> ORDER_CANCELLED notification
    const cancelCreate = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', `p7-cancel-${Date.now()}`)
      .send({
        contact: { name: 'Meera', phone: '9876503030', email: 'meera@example.com' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Meera',
          phone: '9876503030',
          line1: '24 Adyar',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant500mlId, qty: 1 }],
        paymentMethod: 'ONLINE',
        dpdpConsent: true,
      })
      .expect(201)
    const cancelSig = paymentGateway.createMockSignedPayment(
      cancelCreate.body.payment.gatewayOrderId,
      'pay_p7_cancel_01',
    )
    await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({ orderId: cancelCreate.body.order.id, ...cancelSig })
      .expect(200)
    await drainQueuedNotifications()
    await request(app.getHttpServer())
      .post(`/api/admin/orders/${cancelCreate.body.order.id}/cancel`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ reason: 'Customer asked to cancel before dispatch' })
      .expect(200)
    batch = await drainQueuedNotifications()
    expect(batch.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_CANCELLED])

    // 5. Late OOS payment auto-refund -> ORDER_LATE_OOS_REFUNDED
    await prisma.variant.update({ where: { id: variant500mlId }, data: { stock: 1, reserved: 0 } })
    const lateOrderRes = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', `p7-late-oos-${Date.now()}`)
      .send({
        contact: { name: 'Vikram', phone: '9876504040', email: 'vikram@example.com' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Vikram',
          phone: '9876504040',
          line1: '9 Mylapore',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant500mlId, qty: 1 }],
        paymentMethod: 'ONLINE',
        dpdpConsent: true,
      })
      .expect(201)
    await prisma.reservation.updateMany({
      where: { order_id: lateOrderRes.body.order.id },
      data: { expires_at: new Date(Date.now() - 25 * 60_000) },
    })
    await checkoutService.releaseExpiredReservations()
    await prisma.variant.update({ where: { id: variant500mlId }, data: { stock: 0, reserved: 0 } })
    await checkoutService.markOrderPaid({
      orderId: lateOrderRes.body.order.id,
      gatewayOrderId: lateOrderRes.body.payment.gatewayOrderId,
      gatewayPaymentId: 'pay_p7_late_oos_01',
      source: 'webhook',
    })
    batch = await drainQueuedNotifications()
    expect(batch.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_LATE_OOS_REFUNDED])
  })

  it('verifies Resend & MSG91 webhooks, populates hashed EmailSuppression on bounce/complaint, and skips future suppressed emails cleanly', async () => {
    const otp = await sendAndVerifyOtp({ phone: '9876505050', purpose: 'COD_CHECKOUT' })
    const codCreate = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('x-cart-session', otp.sessionToken)
      .set('Idempotency-Key', `p7-webhook-supp-${Date.now()}`)
      .send({
        contact: { name: 'Bounced User', phone: '9876505050', email: 'bounced.user@example.com' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Bounced User',
          phone: '9876505050',
          line1: '5 T Nagar',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant1LId, qty: 1 }],
        paymentMethod: 'COD',
        phoneVerificationToken: otp.verificationToken,
        dpdpConsent: true,
      })
      .expect(201)

    await drainQueuedNotifications()
    const orderId = codCreate.body.order.id as string
    const emailMsgId = mockEmail.outbox[mockEmail.outbox.length - 1]!.id
    const smsMsgId = mockSms.outbox[mockSms.outbox.length - 1]!.id

    // Invalid Resend Svix signature -> 401
    await request(app.getHttpServer())
      .post('/api/webhooks/resend')
      .set('svix-id', 'msg_bad_01')
      .set('svix-timestamp', String(Math.floor(Date.now() / 1000)))
      .set('svix-signature', 'v1,invalid')
      .set('Content-Type', 'application/json')
      .send('{"type":"email.delivered"}')
      .expect(401)

    // Valid Resend email.delivered updates notification row & duplicate Svix ID is idempotent
    const resendSecret = NotificationsService.getMockResendWebhookSecretForTests()
    const deliveredBody = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: emailMsgId, to: ['bounced.user@example.com'] },
    })
    const svixDelivered = NotificationsService.computeTestSvixHeaders(
      deliveredBody,
      resendSecret,
      'msg_resend_deliv_01',
    )
    const delivRes = await request(app.getHttpServer())
      .post('/api/webhooks/resend')
      .set('svix-id', svixDelivered.svixId)
      .set('svix-timestamp', svixDelivered.svixTimestamp)
      .set('svix-signature', svixDelivered.svixSignature)
      .set('Content-Type', 'application/json')
      .send(deliveredBody)
      .expect(200)
    expect(delivRes.body.status).toBe('DELIVERED')

    const dupRes = await request(app.getHttpServer())
      .post('/api/webhooks/resend')
      .set('svix-id', svixDelivered.svixId)
      .set('svix-timestamp', svixDelivered.svixTimestamp)
      .set('svix-signature', svixDelivered.svixSignature)
      .set('Content-Type', 'application/json')
      .send(deliveredBody)
      .expect(200)
    expect(dupRes.body.duplicate).toBe(true)

    // Valid Resend email.bounced stores ONLY hashed + masked suppression record & raises WARNING alert
    const bouncedBody = JSON.stringify({
      type: 'email.bounced',
      data: {
        email_id: emailMsgId,
        to: ['bounced.user@example.com'],
        bounce: { type: 'hard', message: '550 5.1.1 Mailbox unavailable' },
      },
    })
    const svixBounced = NotificationsService.computeTestSvixHeaders(
      bouncedBody,
      resendSecret,
      'msg_resend_bounce_01',
    )
    await request(app.getHttpServer())
      .post('/api/webhooks/resend')
      .set('svix-id', svixBounced.svixId)
      .set('svix-timestamp', svixBounced.svixTimestamp)
      .set('svix-signature', svixBounced.svixSignature)
      .set('Content-Type', 'application/json')
      .send(bouncedBody)
      .expect(200)

    const suppressions = await prisma.emailSuppression.findMany()
    expect(suppressions).toHaveLength(1)
    expect(suppressions[0]!.masked_email).toBe('b*****r@example.com')
    expect(suppressions[0]!.reason).toBe('BOUNCE')
    expect(JSON.stringify(suppressions[0])).not.toContain('bounced.user@example.com')

    // Subsequent transition sends SMS as normal, skips email transport cleanly, and marks Email SUPPRESSED
    mockEmail.clear()
    mockSms.clear()
    await request(app.getHttpServer())
      .post(`/api/admin/orders/${orderId}/confirm`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({})
      .expect(200)
    await drainQueuedNotifications()

    expect(mockEmail.outbox).toHaveLength(0)
    expect(mockSms.outbox).toHaveLength(1)
    const suppressedLog = await prisma.notificationLog.findFirstOrThrow({
      where: { order_id: orderId, channel: 'EMAIL', status: 'SUPPRESSED' },
    })
    expect(suppressedLog.error_message).toContain('BOUNCE')

    // Invalid MSG91 webhook secret -> 401; valid callback updates SMS delivery status
    await request(app.getHttpServer())
      .post('/api/webhooks/msg91')
      .set('x-msg91-webhook-secret', 'wrong-secret')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ request_id: smsMsgId, status: 'DELIVERED' }))
      .expect(401)

    const msg91Res = await request(app.getHttpServer())
      .post('/api/webhooks/msg91')
      .set('x-msg91-webhook-secret', NotificationsService.getMockMsg91WebhookSecretForTests())
      .set('x-msg91-event-id', 'evt_msg91_deliv_01')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ request_id: smsMsgId, status: 'DELIVERED' }))
      .expect(200)
    expect(msg91Res.body.status).toBe('DELIVERED')
    const smsLogAfter = await prisma.notificationLog.findFirstOrThrow({
      where: { provider_message_id: smsMsgId },
    })
    expect(smsLogAfter.status).toBe('DELIVERED')
  })

  it('enforces OTP lockout, 45s cooldown, Turnstile CAPTCHA trigger, 3/phone/hr cap, session/phone binding & atomic single-use checkout', async () => {
    // 1. 5 wrong OTP attempts locks challenge cleanly & triggers prior-failure CAPTCHA requirement
    const badSend = await request(app.getHttpServer())
      .post('/api/otp/send')
      .send({ phone: '9876506060', purpose: OTP_PURPOSE.COD_CHECKOUT })
      .expect(200)
    const badSession = badSend.headers['x-cart-session'] as string

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/otp/verify')
        .set('x-cart-session', badSession)
        .send({
          challengeId: badSend.body.challengeId,
          phone: '9876506060',
          code: '000000',
          purpose: OTP_PURPOSE.COD_CHECKOUT,
        })
        .expect(400)
    }

    // Immediate resend in same session -> 429 cooldown
    await request(app.getHttpServer())
      .post('/api/otp/send')
      .set('x-cart-session', badSession)
      .send({ phone: '9876506060', purpose: OTP_PURPOSE.COD_CHECKOUT })
      .expect(429)

    // 2. Fresh phone: 2 sends succeed without Turnstile, 3rd requires CAPTCHA (400 CAPTCHA_REQUIRED), 4th hits 3/hr (429)
    const pumpPhone = '9876507070'
    await request(app.getHttpServer())
      .post('/api/otp/send')
      .send({ phone: pumpPhone, purpose: OTP_PURPOSE.COD_CHECKOUT })
      .expect(200)
    await request(app.getHttpServer())
      .post('/api/otp/send')
      .send({ phone: pumpPhone, purpose: OTP_PURPOSE.COD_CHECKOUT })
      .expect(200)

    const captchaErr = await request(app.getHttpServer())
      .post('/api/otp/send')
      .send({ phone: pumpPhone, purpose: OTP_PURPOSE.COD_CHECKOUT })
      .expect(400)
    expect(captchaErr.body.code).toBe('CAPTCHA_REQUIRED')
    expect(captchaErr.body.captchaRequired).toBe(true)

    const withCaptcha = await sendAndVerifyOtp({
      phone: pumpPhone,
      purpose: OTP_PURPOSE.COD_CHECKOUT,
      turnstileToken: TurnstileService.NON_PROD_TEST_PASS_TOKEN,
    })

    // 4th send for same phone within 1h hits PHONE_PER_HOUR (3)
    await request(app.getHttpServer())
      .post('/api/otp/send')
      .send({
        phone: pumpPhone,
        purpose: OTP_PURPOSE.COD_CHECKOUT,
        turnstileToken: TurnstileService.NON_PROD_TEST_PASS_TOKEN,
      })
      .expect(429)

    // 3. Token bound strictly to phone + session + single-use: mismatched phone & mismatched session rejected (403)
    await request(app.getHttpServer())
      .post('/api/checkout')
      .set('x-cart-session', withCaptcha.sessionToken)
      .set('Idempotency-Key', `p7-wrong-phone-${Date.now()}`)
      .send({
        contact: { name: 'Attacker', phone: '9876507999' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Attacker',
          phone: '9876507999',
          line1: '10 Anna Salai',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant1LId, qty: 1 }],
        paymentMethod: 'COD',
        phoneVerificationToken: withCaptcha.verificationToken,
        dpdpConsent: true,
      })
      .expect(403)

    await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', `p7-wrong-sess-${Date.now()}`)
      .send({
        contact: { name: 'Session Steal', phone: pumpPhone },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Session Steal',
          phone: pumpPhone,
          line1: '10 Anna Salai',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant1LId, qty: 1 }],
        paymentMethod: 'COD',
        phoneVerificationToken: withCaptcha.verificationToken,
        dpdpConsent: true,
      })
      .expect(403)

    // Concurrent replay of SAME single-use verificationToken across two different Idempotency-Keys -> strictly 1 winner (201), 1 loser (403)
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/checkout')
        .set('x-cart-session', withCaptcha.sessionToken)
        .set('Idempotency-Key', `p7-race-tok-a-${Date.now()}`)
        .send({
          contact: { name: 'Valid COD', phone: pumpPhone },
          fulfilmentMethod: 'DELIVERY',
          address: {
            name: 'Valid COD',
            phone: pumpPhone,
            line1: '10 Anna Salai',
            city: 'Chennai',
            state: 'Tamil Nadu',
            pincode: '600001',
          },
          items: [{ variantId: variant1LId, qty: 1 }],
          paymentMethod: 'COD',
          phoneVerificationToken: withCaptcha.verificationToken,
          dpdpConsent: true,
        }),
      request(app.getHttpServer())
        .post('/api/checkout')
        .set('x-cart-session', withCaptcha.sessionToken)
        .set('Idempotency-Key', `p7-race-tok-b-${Date.now()}`)
        .send({
          contact: { name: 'Valid COD', phone: pumpPhone },
          fulfilmentMethod: 'DELIVERY',
          address: {
            name: 'Valid COD',
            phone: pumpPhone,
            line1: '10 Anna Salai',
            city: 'Chennai',
            state: 'Tamil Nadu',
            pincode: '600001',
          },
          items: [{ variantId: variant1LId, qty: 1 }],
          paymentMethod: 'COD',
          phoneVerificationToken: withCaptcha.verificationToken,
          dpdpConsent: true,
        }),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([201, 403])

    // 4. Online orders require ZERO OTP verification
    await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', `p7-online-no-otp-${Date.now()}`)
      .send({
        contact: { name: 'Frictionless', phone: '9876508181' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Frictionless',
          phone: '9876508181',
          line1: '10 Marina',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: variant500mlId, qty: 1 }],
        paymentMethod: 'ONLINE',
        dpdpConsent: true,
      })
      .expect(201)
  })

  it('defers pickup code generation until READY_FOR_PICKUP, rotates cleanly via OTP, and supports counter handoff + photo-ID fallback', async () => {
    const pickupPhone = '9876509191'
    const pickupCreate = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', `p7-pickup-defer-${Date.now()}`)
      .send({
        contact: { name: 'Store Buyer', phone: pickupPhone, email: 'storebuyer@example.com' },
        fulfilmentMethod: 'STORE_PICKUP',
        pickupLocationId,
        items: [{ variantId: variant1LId, qty: 1 }],
        paymentMethod: 'ONLINE',
        dpdpConsent: true,
      })
      .expect(201)

    expect(pickupCreate.body.order.pickupCode).toBeNull()
    const orderId = pickupCreate.body.order.id as string
    const orderNumber = pickupCreate.body.order.orderNumber as string

    const sig = paymentGateway.createMockSignedPayment(
      pickupCreate.body.payment.gatewayOrderId,
      'pay_p7_pickup_01',
    )
    const verifyRes = await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({ orderId, ...sig })
      .expect(200)
    expect(verifyRes.body.order.pickupCode).toBeNull()
    await drainQueuedNotifications()

    // Reissue before READY_FOR_PICKUP fails cleanly
    const earlyReissueOtp = await sendAndVerifyOtp({
      phone: pickupPhone,
      purpose: OTP_PURPOSE.PICKUP_CODE_REISSUE,
    })
    await request(app.getHttpServer())
      .post('/api/orders/pickup-code/reissue')
      .set('x-cart-session', earlyReissueOtp.sessionToken)
      .send({
        orderNumber,
        phone: pickupPhone,
        verificationToken: earlyReissueOtp.verificationToken,
      })
      .expect(400)

    // Pack -> Ready-for-pickup generates fresh 6-digit pickup code + lastCollectionDate & dispatches SMS+Email
    await request(app.getHttpServer())
      .post(`/api/admin/orders/${orderId}/pack`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({})
      .expect(200)
    await drainQueuedNotifications()

    mockSms.clear()
    mockEmail.clear()
    const readyRes = await request(app.getHttpServer())
      .post(`/api/admin/orders/${orderId}/ready-for-pickup`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .expect(200)
    const readyParsed = adminOrderTransitionResponseSchema.parse(readyRes.body)
    expect(readyParsed.orderStatus).toBe('READY_FOR_PICKUP')
    expect(readyParsed.lastCollectionDate).toBeTruthy()

    const readyJobs = await drainQueuedNotifications()
    expect(readyJobs.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_READY_FOR_PICKUP])
    expect(mockSms.outbox).toHaveLength(1)
    expect(mockEmail.outbox).toHaveLength(1)

    const code1Match = mockSms.outbox[0]!.textBody.match(/\b(\d{6})\b/)
    expect(code1Match).toBeTruthy()
    const code1 = code1Match![1]!
    expect(mockEmail.outbox[0]!.html).toContain(code1)
    expect(mockEmail.outbox[0]!.html).toContain(readyParsed.lastCollectionDate!)

    // Wait-free rotation test: advance pickup_code_last_sent_at back 10m to test valid customer OTP rotation
    await prisma.order.update({
      where: { id: orderId },
      data: { pickup_code_last_sent_at: new Date(Date.now() - 10 * 60_000) },
    })
    const rotOtp = await sendAndVerifyOtp({
      phone: pickupPhone,
      purpose: OTP_PURPOSE.PICKUP_CODE_REISSUE,
    })
    mockSms.clear()
    mockEmail.clear()
    const reissueRes = await request(app.getHttpServer())
      .post('/api/orders/pickup-code/reissue')
      .set('x-cart-session', rotOtp.sessionToken)
      .send({
        orderNumber,
        phone: pickupPhone,
        verificationToken: rotOtp.verificationToken,
      })
      .expect(200)
    expect(pickupCodeReissueResponseSchema.parse(reissueRes.body).sent).toBe(true)

    // Cooldown immediately blocks rapid second rotation (429)
    const rotOtp2 = await sendAndVerifyOtp({
      phone: pickupPhone,
      purpose: OTP_PURPOSE.PICKUP_CODE_REISSUE,
      turnstileToken: TurnstileService.NON_PROD_TEST_PASS_TOKEN,
    })
    await request(app.getHttpServer())
      .post('/api/orders/pickup-code/reissue')
      .set('x-cart-session', rotOtp2.sessionToken)
      .send({
        orderNumber,
        phone: pickupPhone,
        verificationToken: rotOtp2.verificationToken,
      })
      .expect(429)

    const rotJobs = await drainQueuedNotifications()
    expect(rotJobs.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.PICKUP_CODE_REISSUED])
    const code2 = mockSms.outbox[mockSms.outbox.length - 1]!.textBody.match(/\b(\d{6})\b/)![1]!

    // Earlier code1 is invalidated immediately on rotation (only check if random code1 !== code2, guaranteed virtually always; force distinct guarantee)
    if (code1 !== code2) {
      await request(app.getHttpServer())
        .post(`/api/admin/orders/${orderId}/pickup-complete`)
        .set('x-admin-secret', ADMIN_SECRET)
        .set('x-admin-email', ADMIN_EMAIL)
        .send({ pickupCode: code1 })
        .expect(400)
    }

    // Valid code2 completes pickup -> PICKED_UP & notifies customer
    const completeRes = await request(app.getHttpServer())
      .post(`/api/admin/orders/${orderId}/pickup-complete`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ pickupCode: code2 })
      .expect(200)
    expect(adminOrderTransitionResponseSchema.parse(completeRes.body).orderStatus).toBe('PICKED_UP')
    const pickedBatch = await drainQueuedNotifications()
    expect(pickedBatch.map((j) => j.event)).toEqual([NOTIFICATION_EVENT.ORDER_PICKED_UP])

    // Second store-pickup order verifies 5-attempt lockout + photo ID fallback handoff
    const fallbackCreate = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', `p7-pickup-fallback-${Date.now()}`)
      .send({
        contact: { name: 'ID Fallback Buyer', phone: '9876509292' },
        fulfilmentMethod: 'STORE_PICKUP',
        pickupLocationId,
        items: [{ variantId: variant500mlId, qty: 1 }],
        paymentMethod: 'ONLINE',
        dpdpConsent: true,
      })
      .expect(201)
    const fbOrderId = fallbackCreate.body.order.id as string
    const fbSig = paymentGateway.createMockSignedPayment(
      fallbackCreate.body.payment.gatewayOrderId,
      'pay_p7_fb_01',
    )
    await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({ orderId: fbOrderId, ...fbSig })
      .expect(200)
    await request(app.getHttpServer())
      .post(`/api/admin/orders/${fbOrderId}/pack`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({})
      .expect(200)
    await request(app.getHttpServer())
      .post(`/api/admin/orders/${fbOrderId}/ready-for-pickup`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .expect(200)

    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer())
        .post(`/api/admin/orders/${fbOrderId}/pickup-complete`)
        .set('x-admin-secret', ADMIN_SECRET)
        .set('x-admin-email', ADMIN_EMAIL)
        .send({ pickupCode: '000000' })
        .expect(400)
    }
    await request(app.getHttpServer())
      .post(`/api/admin/orders/${fbOrderId}/pickup-complete`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ pickupCode: '000000' })
      .expect(429)

    // Counter staff verifies photo ID fallback cleanly even when pickup code is locked
    const fbComplete = await request(app.getHttpServer())
      .post(`/api/admin/orders/${fbOrderId}/pickup-complete`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ photoIdFallbackNote: 'Verified Aadhaar ending 4421 with matching customer' })
      .expect(200)
    expect(adminOrderTransitionResponseSchema.parse(fbComplete.body).orderStatus).toBe('PICKED_UP')
  })

  it('dispatches tiered owner alerts, enforces prod block on /admin/alerts/test, and fires CRITICAL alerts on low SMS credits or unhealthy providers', async () => {
    // 1. Staging test alerts: INFO (logs only), WARNING (email only), CRITICAL (email + SMS)
    const infoRes = await request(app.getHttpServer())
      .post('/api/admin/alerts/test')
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ severity: 'INFO', message: 'Info probe test' })
      .expect(200)
    expect(adminTestAlertResponseSchema.parse(infoRes.body).channels).toMatchObject({
      emailRecipients: 0,
      smsRecipients: 0,
    })

    const warnRes = await request(app.getHttpServer())
      .post('/api/admin/alerts/test')
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ severity: 'WARNING', message: 'Warning probe test' })
      .expect(200)
    expect(warnRes.body.channels).toMatchObject({ emailRecipients: 2, smsRecipients: 0 })

    const critRes = await request(app.getHttpServer())
      .post('/api/admin/alerts/test')
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', ADMIN_EMAIL)
      .send({ severity: 'CRITICAL', message: 'Critical probe test' })
      .expect(200)
    expect(critRes.body.channels).toMatchObject({ emailRecipients: 2, smsRecipients: 1 })

    await drainQueuedAlerts()
    // 2 warnings (to 2 owner emails) + 2 critical emails + 1 critical SMS
    expect(mockEmail.outbox).toHaveLength(4)
    expect(mockSms.outbox).toHaveLength(1)

    // 2. Production guard blocks /admin/alerts/test (403)
    const prevEnv = env.APP_ENV
    env.APP_ENV = 'production'
    try {
      await request(app.getHttpServer())
        .post('/api/admin/alerts/test')
        .set('x-admin-secret', ADMIN_SECRET)
        .set('x-admin-email', ADMIN_EMAIL)
        .send({ severity: 'WARNING' })
        .expect(403)
    } finally {
      env.APP_ENV = prevEnv
    }

    // 3. Periodic health & low SMS balance monitor
    mockEmail.clear()
    mockSms.clear()
    enqueuedAlerts = []

    mockSms.setBalance(120) // < SMS_LOW_BALANCE_THRESHOLD (500)
    const lowBalOutcome = await notificationsService.runProviderHealthAndBalanceCheck()
    expect(lowBalOutcome.smsBalance).toBe(120)
    expect(
      enqueuedAlerts.some((a) => a.alertKey === 'sms-low-balance' && a.severity === 'CRITICAL'),
    ).toBe(true)

    mockSms.setBalance(2500)
    mockEmail.setHealthy(false)
    mockSms.setHealthy(false)
    const downOutcome = await notificationsService.runProviderHealthAndBalanceCheck()
    expect(downOutcome.emailHealthy).toBe(false)
    expect(downOutcome.smsHealthy).toBe(false)
    expect(enqueuedAlerts.some((a) => a.alertKey === 'email-provider-unhealthy')).toBe(true)
    expect(enqueuedAlerts.some((a) => a.alertKey === 'sms-provider-unhealthy')).toBe(true)

    await drainQueuedAlerts()
    expect(mockSms.outbox.length).toBeGreaterThanOrEqual(3)
    expect(mockEmail.outbox.length).toBeGreaterThanOrEqual(6)
    // Owner operational alerts never contain customer personal data
    for (const mail of mockEmail.outbox) {
      expect(mail.text).toContain('No customer PII included')
    }
  })
})
