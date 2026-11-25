import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  adminCancelOrderResponseSchema,
  adminRefundOrderResponseSchema,
  adminReturnStockResponseSchema,
  checkoutResponseSchema,
  webhookAckResponseSchema,
} from '@pressedoils/shared'
import Redis from 'ioredis'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app-setup'
import { CheckoutService } from '../src/checkout/checkout.service'
import { PaymentGatewayService } from '../src/checkout/payment-gateway.service'
import { env, validateEnv } from '../src/env'
import { PrismaService } from '../src/prisma/prisma.service'
import { ProductCacheService } from '../src/products/products.cache'
import { OpsAlertService } from '../src/queue/ops-alert.service'
import { SettingsService } from '../src/settings/settings.service'

const apiRoot = resolve(__dirname, '..')
const OWNER_EMAIL = 'owner-dev@example.invalid'
const ADMIN_SECRET = process.env.OWNER_SETTINGS_SECRET || 'dev-owner-settings-secret-local'

describe('Phase 6 Webhooks, Reconciliation, Concurrency & Admin Order Lifecycle (integration)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let checkoutService: CheckoutService
  let paymentGateway: PaymentGatewayService
  let opsAlertService: OpsAlertService
  let settingsService: SettingsService
  let cacheService: ProductCacheService
  let variant1LId: string
  let variant500mlId: string

  async function cleanOrdersAndEvents() {
    await prisma.checkoutIdempotencyKey.deleteMany()
    await prisma.webhookEvent.deleteMany()
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

  async function createOnlineCheckout(
    tag: string,
    variantId: string,
    qty: number,
    couponCode?: string,
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/checkout')
      .set('Idempotency-Key', `phase6-${tag}-${Date.now()}`)
      .send({
        contact: { name: `Customer ${tag}`, phone: '9876511111' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: `Customer ${tag}`,
          phone: '9876511111',
          line1: '10 Oil Mill Rd',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId, qty }],
        paymentMethod: 'ONLINE',
        ...(couponCode ? { couponCode } : {}),
        dpdpConsent: true,
      })
      .expect(201)

    return checkoutResponseSchema.parse(res.body)
  }

  function signWebhookBody(raw: string): string {
    return paymentGateway.createMockWebhookSignature(Buffer.from(raw, 'utf8'))
  }

  beforeAll(async () => {
    execFileSync('pnpm', ['exec', 'tsx', 'prisma/seed.dev.ts'], {
      cwd: apiRoot,
      env: { ...process.env, NODE_ENV: 'development', APP_ENV: 'development' },
      shell: process.platform === 'win32',
    })

    // Ensure temp admin routes & env match test expectations before AppModule boots
    env.APP_ENV = 'development'
    env.ENABLE_TEMP_ADMIN_API = 'true'
    env.OWNER_SETTINGS_SECRET = ADMIN_SECRET
    env.PAYMENT_GATEWAY = 'mock'

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
      CORS_ORIGINS: 'http://localhost:3000',
    })
    configureApp(app, testEnv)
    await app.init()

    prisma = app.get(PrismaService)
    checkoutService = app.get(CheckoutService)
    paymentGateway = app.get(PaymentGatewayService)
    opsAlertService = app.get(OpsAlertService)
    settingsService = app.get(SettingsService)
    cacheService = app.get(ProductCacheService)

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
    await cleanOrdersAndEvents()

    const list = await request(app.getHttpServer()).get('/api/products?pageSize=6').expect(200)
    variant1LId = list.body.items[0].variants.find(
      (v: { sizeLabel: string }) => v.sizeLabel === '1 L',
    ).id
    variant500mlId = list.body.items[0].variants.find(
      (v: { sizeLabel: string }) => v.sizeLabel === '500 ml',
    ).id
  })

  afterAll(async () => {
    await cleanOrdersAndEvents()
    await app.close()
  })

  it('verifies raw-body HMAC signature before parsing, rejects tampering/missing signatures with 401, dedupes event_id, and ignores unknown orders cleanly', async () => {
    const order = await createOnlineCheckout('wh-raw', variant1LId, 2)
    const compactPayload = JSON.stringify({
      id: 'evt_p6_sig_test_01',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_p6_sig_01',
            order_id: order.payment!.gatewayOrderId,
            amount: order.order.totalPaise,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    })
    const validSig = signWebhookBody(compactPayload)

    // 1. Missing or invalid signature gets 401 and writes NO webhook_events row
    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send(compactPayload)
      .expect(401)

    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', `${validSig.slice(0, -2)}00`)
      .send(compactPayload)
      .expect(401)

    // 2. Modified whitespace with signature computed for compactPayload MUST fail raw-byte check
    const prettyPayload = JSON.stringify(JSON.parse(compactPayload), null, 2)
    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', validSig)
      .send(prettyPayload)
      .expect(401)

    expect(await prisma.webhookEvent.count({ where: { event_id: 'evt_p6_sig_test_01' } })).toBe(0)

    // 3. Valid raw payload processes cleanly and auto-confirms (PAID -> CONFIRMED)
    const ack1 = await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', validSig)
      .set('x-razorpay-event-id', 'evt_p6_sig_test_01')
      .send(compactPayload)
      .expect(200)
    expect(webhookAckResponseSchema.parse(ack1.body)).toMatchObject({
      received: true,
      duplicate: false,
      eventId: 'evt_p6_sig_test_01',
      outcome: 'PROCESSED',
    })

    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.order.id } })
    expect(dbOrder.order_status).toBe('CONFIRMED')
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })).stock).toBe(48)

    // 4. Duplicate delivery of same event_id returns 200 DUPLICATE and does nothing
    const ack2 = await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', validSig)
      .set('x-razorpay-event-id', 'evt_p6_sig_test_01')
      .send(compactPayload)
      .expect(200)
    expect(webhookAckResponseSchema.parse(ack2.body)).toMatchObject({
      received: true,
      duplicate: true,
      eventId: 'evt_p6_sig_test_01',
      outcome: 'DUPLICATE',
    })
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })).stock).toBe(48)

    // 5. Unknown gateway order ID returns 200 IGNORED
    const unknownBody = JSON.stringify({
      id: 'evt_p6_unknown_order_01',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_unknown_99',
            order_id: 'order_unknown_99',
            amount: 10000,
            currency: 'INR',
          },
        },
      },
    })
    const unknownAck = await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhookBody(unknownBody))
      .send(unknownBody)
      .expect(200)
    expect(unknownAck.body.outcome).toBe('IGNORED')

    // Verify notification queued onto durable QUEUE_REDIS_URL Redis if configured
    if (process.env.QUEUE_REDIS_URL) {
      const q = new Redis(process.env.QUEUE_REDIS_URL)
      const keys = await q.keys('bull:notifications:*')
      expect(keys.length).toBeGreaterThan(0)
      await q.quit()
    }
  })

  it('handles parallel POST /checkout/verify + POST /webhooks/razorpay race idempotently with single stock deduction', async () => {
    await cleanOrdersAndEvents()
    await prisma.coupon.update({
      where: { code: 'SAMPLE10' },
      data: { used_count: 0, usage_limit: 5, is_active: true },
    })

    const session = await createOnlineCheckout('race', variant1LId, 2, 'SAMPLE10')
    const signed = paymentGateway.createMockSignedPayment(
      session.payment!.gatewayOrderId,
      'pay_p6_concurrent_01',
    )
    const webhookRaw = JSON.stringify({
      id: 'evt_p6_concurrent_01',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: signed.razorpayPaymentId,
            order_id: signed.razorpayOrderId,
            amount: session.order.totalPaise,
            currency: 'INR',
          },
        },
      },
    })

    const [verifyRes, webhookRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/checkout/verify')
        .send({ orderId: session.order.id, ...signed }),
      request(app.getHttpServer())
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signWebhookBody(webhookRaw))
        .send(webhookRaw),
    ])

    expect(verifyRes.status).toBe(200)
    expect(webhookRes.status).toBe(200)

    const variantAfter = await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })
    expect(variantAfter.stock).toBe(48)
    expect(variantAfter.reserved).toBe(0)
    const payments = await prisma.payment.findMany({ where: { order_id: session.order.id } })
    expect(payments).toHaveLength(1)
    expect(payments[0]!.status).toBe('CAPTURED')
  })

  it('refuses PAID and sets needs_attention + alerts a person without auto-refunding on amount or currency mismatch', async () => {
    await cleanOrdersAndEvents()
    const alertSpy = vi.spyOn(opsAlertService, 'alertCritical')

    const orderA = await createOnlineCheckout('mismatch-amt', variant1LId, 1)
    const badAmountRaw = JSON.stringify({
      id: 'evt_p6_mismatch_amt',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_mismatch_amt_01',
            order_id: orderA.payment!.gatewayOrderId,
            amount: orderA.order.totalPaise - 100, // Underpaid!
            currency: 'INR',
          },
        },
      },
    })
    const resAmt = await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhookBody(badAmountRaw))
      .send(badAmountRaw)
      .expect(200)
    expect(resAmt.body.outcome).toBe('MISMATCH_ALERTED')

    const dbOrderA = await prisma.order.findUniqueOrThrow({ where: { id: orderA.order.id } })
    expect(dbOrderA.order_status).toBe('PENDING_PAYMENT')
    expect(dbOrderA.payment_status).toBe('PENDING')
    expect(dbOrderA.needs_attention).toBe(true)
    expect(await prisma.refund.count({ where: { order_id: orderA.order.id } })).toBe(0)

    const orderB = await createOnlineCheckout('mismatch-curr', variant500mlId, 1)
    const badCurrencyRaw = JSON.stringify({
      id: 'evt_p6_mismatch_curr',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_mismatch_curr_01',
            order_id: orderB.payment!.gatewayOrderId,
            amount: orderB.order.totalPaise,
            currency: 'USD',
          },
        },
      },
    })
    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhookBody(badCurrencyRaw))
      .send(badCurrencyRaw)
      .expect(200)

    const dbOrderB = await prisma.order.findUniqueOrThrow({ where: { id: orderB.order.id } })
    expect(dbOrderB.order_status).toBe('PENDING_PAYMENT')
    expect(dbOrderB.needs_attention).toBe(true)
    expect(alertSpy).toHaveBeenCalledTimes(2)
    alertSpy.mockRestore()
  })

  it('keeps reservation intact across <5 payment.failed attempts, refuses /checkout/fail while authorized, and releases on 5th failed attempt', async () => {
    await cleanOrdersAndEvents()
    const order = await createOnlineCheckout('fail-cap', variant1LId, 2)
    const gwOrderId = order.payment!.gatewayOrderId
    const token = order.payment!.checkoutToken

    // First 4 failed attempts record events + payments but KEEP reservation intact so customer can retry
    for (let i = 1; i <= 4; i += 1) {
      const failBody = JSON.stringify({
        id: `evt_p6_fail_${i}`,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: `pay_p6_fail_${i}`,
              order_id: gwOrderId,
              amount: order.order.totalPaise,
              currency: 'INR',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'UPI pin expired',
            },
          },
        },
      })
      const r = await request(app.getHttpServer())
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signWebhookBody(failBody))
        .send(failBody)
        .expect(200)
      expect(r.body.outcome).toBe('RECORDED')
    }

    const midOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.order.id } })
    expect(midOrder.failed_payment_attempts).toBe(4)
    expect(midOrder.order_status).toBe('PENDING_PAYMENT')
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })).reserved).toBe(
      2,
    )

    // Never release on /checkout/fail OR expiry sweep while gateway status is authorized
    paymentGateway.mockRecordAuthorizedPayment(
      gwOrderId,
      'pay_p6_auth_hold',
      order.order.totalPaise,
    )
    const dismissRes = await request(app.getHttpServer())
      .post('/api/checkout/fail')
      .send({ orderId: order.order.id, orderToken: token, reason: 'MODAL_DISMISSED' })
      .expect(200)
    expect(dismissRes.body.released).toBe(false)
    expect(dismissRes.body.orderStatus).toBe('PENDING_PAYMENT')
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })).reserved).toBe(
      2,
    )

    // Clear authorized payment -> 5th failed webhook releases reservation cleanly
    ;(paymentGateway as unknown as { mockOrders: Map<string, unknown> }).mockOrders.set(gwOrderId, {
      amountPaise: order.order.totalPaise,
      capturedPaymentId: null,
      authorizedPaymentId: null,
      refunded: false,
    })

    const fail5Raw = JSON.stringify({
      id: 'evt_p6_fail_5',
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_p6_fail_5',
            order_id: gwOrderId,
            amount: order.order.totalPaise,
            currency: 'INR',
            error_code: 'GATEWAY_ERROR',
          },
        },
      },
    })
    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhookBody(fail5Raw))
      .send(fail5Raw)
      .expect(200)

    const endOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.order.id } })
    expect(endOrder.failed_payment_attempts).toBe(5)
    expect(endOrder.order_status).toBe('CANCELLED')
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })).reserved).toBe(
      0,
    )
  })

  it('reconciles stuck 2m-1h captured payments, preserves authorized ones, and expires abandoned >24h orders', async () => {
    await cleanOrdersAndEvents()
    const recentCaptured = await createOnlineCheckout('rec-recent', variant1LId, 1)
    const authorizedHold = await createOnlineCheckout('rec-auth', variant1LId, 1)
    const abandoned24h = await createOnlineCheckout('rec-24h', variant1LId, 1)

    const tenMinAgo = new Date(Date.now() - 10 * 60_000)
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60_000)

    await prisma.order.update({
      where: { id: recentCaptured.order.id },
      data: { created_at: tenMinAgo },
    })
    await prisma.order.update({
      where: { id: authorizedHold.order.id },
      data: { created_at: tenMinAgo },
    })
    await prisma.order.update({
      where: { id: abandoned24h.order.id },
      data: { created_at: twentyFiveHoursAgo },
    })

    paymentGateway.mockRecordCapturedPayment(
      recentCaptured.payment!.gatewayOrderId,
      'pay_p6_reconcile_recent',
      recentCaptured.order.totalPaise,
    )
    paymentGateway.mockRecordAuthorizedPayment(
      authorizedHold.payment!.gatewayOrderId,
      'pay_p6_reconcile_auth',
      authorizedHold.order.totalPaise,
    )

    const recentSweep = await checkoutService.reconcileStuckPayments({
      minAgeMinutes: 2,
      maxAgeMinutes: 60,
      pauseMs: 0,
    })
    expect(recentSweep.recoveredPaidCount).toBe(1)
    expect(recentSweep.skippedAuthorizedCount).toBe(1)
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: recentCaptured.order.id } }))
        .order_status,
    ).toBe('CONFIRMED')
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: authorizedHold.order.id } }))
        .order_status,
    ).toBe('PENDING_PAYMENT')

    const agingSweep = await checkoutService.reconcileStuckPayments({
      minAgeMinutes: 60,
      maxAgeMinutes: 24 * 60,
      expireAfterMinutes: 24 * 60,
      pauseMs: 0,
    })
    expect(agingSweep.expiredCount).toBe(1)
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: abandoned24h.order.id } })).order_status,
    ).toBe('CANCELLED')
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })).reserved).toBe(
      1,
    )
  })

  it('keeps PAID and CONFIRMED distinct when auto_confirm_paid_orders=false, enforces cancel once vs shipped, partial/full refunds without auto-restock, and explicit return-stock', async () => {
    await cleanOrdersAndEvents()

    // 1. Toggle auto_confirm_paid_orders = false via temp admin endpoint
    await request(app.getHttpServer())
      .patch('/api/admin/settings')
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .send({ autoConfirmPaidOrders: { enabled: false } })
      .expect(200)

    const manualOrder = await createOnlineCheckout('manual-confirm', variant1LId, 2)
    const sig1 = paymentGateway.createMockSignedPayment(
      manualOrder.payment!.gatewayOrderId,
      'pay_p6_manual_01',
    )
    const verifyManual = await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({ orderId: manualOrder.order.id, ...sig1 })
      .expect(200)
    expect(verifyManual.body.order.orderStatus).toBe('PAID')

    // Confirm manually -> moves PAID -> CONFIRMED + AuditLog; second confirm rejects 409
    const confRes = await request(app.getHttpServer())
      .post(`/api/admin/orders/${manualOrder.order.id}/confirm`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .send({ reason: 'Verified stock ready' })
      .expect(200)
    expect(confRes.body.orderStatus).toBe('CONFIRMED')

    await request(app.getHttpServer())
      .post(`/api/admin/orders/${manualOrder.order.id}/confirm`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .send({})
      .expect(409)

    // Restore auto_confirm = true
    await request(app.getHttpServer())
      .patch('/api/admin/settings')
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .send({ autoConfirmPaidOrders: { enabled: true } })
      .expect(200)

    // 2. Partial refund -> refund.processed webhook updates cumulative refunded_paise without restoring stock;
    // unexpected unshipped dashboard refund alerts operator
    const totalPaise = manualOrder.order.totalPaise
    const partialRes = await request(app.getHttpServer())
      .post(`/api/admin/orders/${manualOrder.order.id}/refund`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .set('Idempotency-Key', 'p6-partial-refund-key-001')
      .send({ amountPaise: 15000, reason: 'Damaged outer carton goodwill' })
      .expect(200)
    const partialParsed = adminRefundOrderResponseSchema.parse(partialRes.body)
    expect(partialParsed.status).toBe('PENDING')
    expect(partialParsed.remainingRefundablePaise).toBe(totalPaise - 15000)

    // Replay with same key returns same refundId; conflicting amount returns 409; over-balance returns 400
    const replayPartial = await request(app.getHttpServer())
      .post(`/api/admin/orders/${manualOrder.order.id}/refund`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .set('Idempotency-Key', 'p6-partial-refund-key-001')
      .send({ amountPaise: 15000, reason: 'Retry' })
      .expect(200)
    expect(replayPartial.body.refundId).toBe(partialParsed.refundId)

    await request(app.getHttpServer())
      .post(`/api/admin/orders/${manualOrder.order.id}/refund`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .set('Idempotency-Key', 'p6-partial-refund-key-001')
      .send({ amountPaise: 16000, reason: 'Tamper amount' })
      .expect(409)

    await request(app.getHttpServer())
      .post(`/api/admin/orders/${manualOrder.order.id}/refund`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .set('Idempotency-Key', 'p6-over-balance-refund-key-001')
      .send({ amountPaise: totalPaise, reason: 'Over remaining balance' })
      .expect(400)

    // Send refund.processed webhook for partial refund -> PARTIALLY_REFUNDED, stock UNTOUCHED (still 48!)
    const partialWebhookRaw = JSON.stringify({
      id: 'evt_p6_refund_partial_01',
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: partialParsed.gatewayRefundId,
            payment_id: 'pay_p6_manual_01',
            amount: 15000,
            currency: 'INR',
            status: 'processed',
          },
        },
      },
    })
    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhookBody(partialWebhookRaw))
      .send(partialWebhookRaw)
      .expect(200)

    const afterPartialDb = await prisma.order.findUniqueOrThrow({
      where: { id: manualOrder.order.id },
    })
    expect(afterPartialDb.payment_status).toBe('PARTIALLY_REFUNDED')
    expect(afterPartialDb.refunded_paise).toBe(15000)
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })).stock).toBe(48)

    // Unexpected dashboard refund on unshipped order sets needs_attention + alerts ops + keeps stock untouched
    const alertSpy = vi.spyOn(opsAlertService, 'alertCritical')
    const unshippedRemainder = totalPaise - 15000
    const dashboardRefundRaw = JSON.stringify({
      id: 'evt_p6_dashboard_refund_01',
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_dashboard_direct_99',
            payment_id: 'pay_p6_manual_01',
            amount: unshippedRemainder,
            currency: 'INR',
            status: 'processed',
          },
        },
      },
    })
    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhookBody(dashboardRefundRaw))
      .send(dashboardRefundRaw)
      .expect(200)

    const afterFullDb = await prisma.order.findUniqueOrThrow({
      where: { id: manualOrder.order.id },
    })
    expect(afterFullDb.payment_status).toBe('REFUNDED')
    expect(afterFullDb.order_status).toBe('REFUNDED')
    expect(afterFullDb.refunded_paise).toBe(totalPaise)
    expect(afterFullDb.needs_attention).toBe(true)
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ alertKey: 'unexpected-dashboard-refund', severity: 'CRITICAL' }),
    )
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })).stock).toBe(48)

    // refund.failed webhook also flags needs_attention + alerts
    const refundFailedRaw = JSON.stringify({
      id: 'evt_p6_refund_failed_01',
      event: 'refund.failed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_failed_bank_01',
            payment_id: 'pay_p6_manual_01',
            amount: 5000,
            currency: 'INR',
            status: 'failed',
          },
        },
      },
    })
    await request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhookBody(refundFailedRaw))
      .send(refundFailedRaw)
      .expect(200)
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ alertKey: 'gateway-refund-failed', severity: 'CRITICAL' }),
    )
    alertSpy.mockRestore()

    // 3. Explicit return-stock on post-shipment order (1 SEALED_RESTOCK + 1 DAMAGED_WRITEOFF -> stock becomes 49!)
    const returnRes = await request(app.getHttpServer())
      .post(`/api/admin/orders/${manualOrder.order.id}/return-stock`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .send({
        items: [
          { variantId: variant1LId, qty: 1, condition: 'SEALED_RESTOCK' },
          { variantId: variant1LId, qty: 1, condition: 'DAMAGED_WRITEOFF' },
        ],
        reason: 'Inspected return: 1 sealed jar intact, 1 leaked cap written off',
      })
      .expect(200)
    expect(adminReturnStockResponseSchema.parse(returnRes.body)).toEqual({
      orderId: manualOrder.order.id,
      restockedUnits: 1,
      writtenOffUnits: 1,
    })
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant1LId } })).stock).toBe(49)

    // 4. Admin /cancel restores stock ONCE, blocks double-cancel (409), and blocks shipped orders (400)
    const cancelTarget = await createOnlineCheckout('cancel-twice', variant500mlId, 2)
    const cancelSig = paymentGateway.createMockSignedPayment(
      cancelTarget.payment!.gatewayOrderId,
      'pay_p6_cancel_01',
    )
    await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({ orderId: cancelTarget.order.id, ...cancelSig })
      .expect(200)
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant500mlId } })).stock).toBe(
      48,
    )

    const cancelRes = await request(app.getHttpServer())
      .post(`/api/admin/orders/${cancelTarget.order.id}/cancel`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .send({ reason: 'Customer requested cancellation before dispatch' })
      .expect(200)
    const cancelParsed = adminCancelOrderResponseSchema.parse(cancelRes.body)
    expect(cancelParsed.restoredUnits).toBe(2)
    expect(cancelParsed.refundInitiated).toBe(true)
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant500mlId } })).stock).toBe(
      50,
    )

    // Double cancel MUST fail 409 and never increment stock again
    await request(app.getHttpServer())
      .post(`/api/admin/orders/${cancelTarget.order.id}/cancel`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .send({ reason: 'Accidental double click' })
      .expect(409)
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant500mlId } })).stock).toBe(
      50,
    )

    // Shipped order rejects /cancel (400)
    const shippedOrder = await createOnlineCheckout('shipped-nocancel', variant500mlId, 1)
    const shippedSig = paymentGateway.createMockSignedPayment(
      shippedOrder.payment!.gatewayOrderId,
      'pay_p6_shipped_01',
    )
    await request(app.getHttpServer())
      .post('/api/checkout/verify')
      .send({ orderId: shippedOrder.order.id, ...shippedSig })
      .expect(200)
    await prisma.order.update({
      where: { id: shippedOrder.order.id },
      data: { order_status: 'SHIPPED' },
    })
    await request(app.getHttpServer())
      .post(`/api/admin/orders/${shippedOrder.order.id}/cancel`)
      .set('x-admin-secret', ADMIN_SECRET)
      .set('x-admin-email', OWNER_EMAIL)
      .send({ reason: 'Try cancelling shipped order' })
      .expect(400)

    // 5. TempAdminGuard rejects APP_ENV=production cleanly even with matching secret
    const prevAppEnv = env.APP_ENV
    env.APP_ENV = 'production'
    try {
      await request(app.getHttpServer())
        .post(`/api/admin/orders/${shippedOrder.order.id}/cancel`)
        .set('x-admin-secret', ADMIN_SECRET)
        .set('x-admin-email', OWNER_EMAIL)
        .send({ reason: 'Blocked in prod' })
        .expect(403)
    } finally {
      env.APP_ENV = prevAppEnv
    }
  })
})
