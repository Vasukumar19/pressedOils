import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { isProductionRuntime } from '@pressedoils/shared'
import { env } from '../env'

const MOCK_DEV_SECRET = 'mock_razorpay_dev_only_secret_do_not_use_in_prod'
const MOCK_WEBHOOK_DEV_SECRET = 'mock_razorpay_webhook_dev_only_secret_do_not_use_in_prod'
const MOCK_DEV_KEY_ID = 'rzp_test_mock_local'
const GATEWAY_TIMEOUT_MS = 8000

export interface CreateGatewayOrderResult {
  gateway: 'razorpay' | 'mock'
  keyId: string
  gatewayOrderId: string
}

export interface GatewayOrderPaymentStatus {
  status: 'captured' | 'authorized' | 'failed' | 'none'
  capturedPaymentId: string | null
  capturedAmountPaise: number | null
  authorizedPaymentId: string | null
  raw?: unknown
}

export interface GatewayRefundResult {
  refunded: boolean
  refundId: string | null
  error?: string
}

export function computeRazorpayHmac(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')
}

export function computeWebhookHmac(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function timingSafeHexEquals(expectedHex: string, actualHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actualHex) || expectedHex.length !== actualHex.length) {
    return false
  }
  const a = Buffer.from(expectedHex.toLowerCase(), 'utf8')
  const b = Buffer.from(actualHex.toLowerCase(), 'utf8')
  return timingSafeEqual(a, b)
}

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name)
  // Test/dev-only in-memory ledger for mock gateway inspection & late-payment simulation
  private readonly mockOrders = new Map<
    string,
    {
      amountPaise: number
      capturedPaymentId: string | null
      authorizedPaymentId: string | null
      refunded: boolean
    }
  >()

  constructor() {
    if (
      isProductionRuntime({
        APP_ENV: env.APP_ENV,
        IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
      }) &&
      (env.PAYMENT_GATEWAY === 'mock' || env.ALLOW_MOCK_GATEWAY === 'true')
    ) {
      throw new Error('FATAL: Mock payment gateway cannot be instantiated in production runtime')
    }
  }

  private isProdRuntime(): boolean {
    return isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })
  }

  getMode(): 'razorpay' | 'mock' {
    return this.isProdRuntime() ? 'razorpay' : env.PAYMENT_GATEWAY
  }

  private getRazorpayAuthHeader(): string {
    const keyId = env.RAZORPAY_KEY_ID
    const keySecret = env.RAZORPAY_KEY_SECRET
    if (!keyId || !keySecret) {
      throw new InternalServerErrorException('Razorpay credentials are not configured')
    }
    return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`
  }

  async createOrder(input: {
    orderId: string
    orderNumber: string
    amountPaise: number
  }): Promise<CreateGatewayOrderResult> {
    if (this.getMode() === 'mock') {
      if (this.isProdRuntime()) {
        throw new InternalServerErrorException('Mock payment gateway blocked in production')
      }
      const gatewayOrderId = `order_mock_${input.orderId.replace(/-/g, '').slice(0, 14)}`
      this.mockOrders.set(gatewayOrderId, {
        amountPaise: input.amountPaise,
        capturedPaymentId: null,
        authorizedPaymentId: null,
        refunded: false,
      })
      return {
        gateway: 'mock',
        keyId: MOCK_DEV_KEY_ID,
        gatewayOrderId,
      }
    }

    const keyId = env.RAZORPAY_KEY_ID
    if (!keyId || !env.RAZORPAY_KEY_SECRET) {
      throw new InternalServerErrorException('Razorpay credentials are not configured')
    }

    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: this.getRazorpayAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.orderNumber,
        payment_capture: 1, // Automatic capture enabled per security specification
        notes: {
          internal_order_id: input.orderId,
          order_number: input.orderNumber,
        },
      }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      this.logger.error({
        event: 'RAZORPAY_CREATE_ORDER_FAILED',
        status: res.status,
        body: text.slice(0, 300),
      })
      throw new InternalServerErrorException('Unable to initialize online payment right now')
    }

    const json = (await res.json()) as { id?: string }
    if (!json.id) {
      throw new InternalServerErrorException('Invalid response from payment gateway')
    }

    return {
      gateway: 'razorpay',
      keyId,
      gatewayOrderId: json.id,
    }
  }

  verifyPaymentSignature(input: {
    razorpayOrderId: string
    razorpayPaymentId: string
    razorpaySignature: string
  }): boolean {
    const mode = this.getMode()
    const secret = mode === 'mock' ? MOCK_DEV_SECRET : env.RAZORPAY_KEY_SECRET
    if (!secret) {
      return false
    }
    const expected = computeRazorpayHmac(input.razorpayOrderId, input.razorpayPaymentId, secret)
    const valid = timingSafeHexEquals(expected, input.razorpaySignature)
    if (valid && mode === 'mock') {
      const record = this.mockOrders.get(input.razorpayOrderId)
      if (record) {
        record.capturedPaymentId = input.razorpayPaymentId
      }
    }
    return valid
  }

  /**
   * Generates a valid signed mock authorization payload ONLY when non-production mock mode is active.
   * Refuses unconditionally in production runtime.
   */
  createMockSignedPayment(
    gatewayOrderId: string,
    gatewayPaymentId?: string,
  ): { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string } {
    if (this.isProdRuntime() || this.getMode() !== 'mock') {
      throw new InternalServerErrorException('Mock payment simulation is disabled')
    }
    const paymentId =
      gatewayPaymentId ?? `pay_mock_${Date.now().toString(36)}_${gatewayOrderId.slice(-6)}`
    const signature = computeRazorpayHmac(gatewayOrderId, paymentId, MOCK_DEV_SECRET)
    const record = this.mockOrders.get(gatewayOrderId)
    if (record) {
      record.capturedPaymentId = paymentId
    }
    return {
      razorpayOrderId: gatewayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    }
  }

  private getWebhookSecret(): string | null {
    if (this.isProdRuntime()) {
      return env.RAZORPAY_WEBHOOK_SECRET ?? null
    }
    if (this.getMode() === 'mock') {
      return env.RAZORPAY_WEBHOOK_SECRET ?? MOCK_WEBHOOK_DEV_SECRET
    }
    return env.RAZORPAY_WEBHOOK_SECRET ?? null
  }

  /**
   * Verifies Razorpay `X-Razorpay-Signature` HMAC-SHA256 over the EXACT raw request bytes
   * using constant-time comparison before JSON parsing.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (rawBody.length === 0 || !signatureHeader || !signatureHeader.trim()) {
      return false
    }
    const secret = this.getWebhookSecret()
    if (!secret) {
      return false
    }
    const expected = computeWebhookHmac(rawBody, secret)
    return timingSafeHexEquals(expected, signatureHeader.trim())
  }

  createMockWebhookSignature(rawBody: Buffer | string): string {
    if (this.isProdRuntime() || this.getMode() !== 'mock') {
      throw new InternalServerErrorException('Mock webhook signing is disabled')
    }
    const secret = this.getWebhookSecret()
    if (!secret) {
      throw new InternalServerErrorException('Mock webhook secret is unavailable')
    }
    return computeWebhookHmac(rawBody, secret)
  }

  /** Used in non-production tests to simulate a captured payment existing at gateway before release. */
  mockRecordCapturedPayment(
    gatewayOrderId: string,
    gatewayPaymentId: string,
    amountPaise: number,
  ): void {
    if (this.isProdRuntime() || this.getMode() !== 'mock') {
      throw new InternalServerErrorException('Mock payment simulation is disabled')
    }
    this.mockOrders.set(gatewayOrderId, {
      amountPaise,
      capturedPaymentId: gatewayPaymentId,
      authorizedPaymentId: null,
      refunded: false,
    })
  }

  /** Used in non-production tests to simulate an authorized (in-flight) payment that must not be released. */
  mockRecordAuthorizedPayment(
    gatewayOrderId: string,
    gatewayPaymentId: string,
    amountPaise: number,
  ): void {
    if (this.isProdRuntime() || this.getMode() !== 'mock') {
      throw new InternalServerErrorException('Mock payment simulation is disabled')
    }
    this.mockOrders.set(gatewayOrderId, {
      amountPaise,
      capturedPaymentId: null,
      authorizedPaymentId: gatewayPaymentId,
      refunded: false,
    })
  }

  async fetchOrderPaymentStatus(gatewayOrderId: string): Promise<GatewayOrderPaymentStatus> {
    if (this.getMode() === 'mock') {
      const record = this.mockOrders.get(gatewayOrderId)
      if (record?.capturedPaymentId) {
        return {
          status: 'captured',
          capturedPaymentId: record.capturedPaymentId,
          capturedAmountPaise: record.amountPaise,
          authorizedPaymentId: null,
          raw: record,
        }
      }
      if (record?.authorizedPaymentId) {
        return {
          status: 'authorized',
          capturedPaymentId: null,
          capturedAmountPaise: null,
          authorizedPaymentId: record.authorizedPaymentId,
          raw: record,
        }
      }
      return {
        status: 'none',
        capturedPaymentId: null,
        capturedAmountPaise: null,
        authorizedPaymentId: null,
        raw: record ?? null,
      }
    }

    try {
      const res = await fetch(`https://api.razorpay.com/v1/orders/${gatewayOrderId}/payments`, {
        method: 'GET',
        headers: {
          Authorization: this.getRazorpayAuthHeader(),
        },
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      })
      if (!res.ok) {
        this.logger.warn({
          event: 'RAZORPAY_FETCH_ORDER_PAYMENTS_WARN',
          gatewayOrderId,
          status: res.status,
        })
        return {
          status: 'none',
          capturedPaymentId: null,
          capturedAmountPaise: null,
          authorizedPaymentId: null,
        }
      }

      const json = (await res.json()) as {
        items?: Array<{ id?: string; status?: string; amount?: number }>
      }
      const items = json.items ?? []
      const captured = items.find((item) => item.status === 'captured' && item.id)
      if (captured?.id) {
        return {
          status: 'captured',
          capturedPaymentId: captured.id,
          capturedAmountPaise: typeof captured.amount === 'number' ? captured.amount : null,
          authorizedPaymentId: null,
          raw: captured,
        }
      }
      const authorized = items.find((item) => item.status === 'authorized' && item.id)
      if (authorized?.id) {
        return {
          status: 'authorized',
          capturedPaymentId: null,
          capturedAmountPaise: null,
          authorizedPaymentId: authorized.id,
          raw: authorized,
        }
      }
      const failed = items.find((item) => item.status === 'failed')
      return {
        status: failed ? 'failed' : 'none',
        capturedPaymentId: null,
        capturedAmountPaise: null,
        authorizedPaymentId: null,
        raw: failed ?? null,
      }
    } catch (error) {
      this.logger.warn({
        event: 'RAZORPAY_FETCH_ORDER_PAYMENTS_ERROR',
        gatewayOrderId,
        error: error instanceof Error ? error.message : 'unknown error',
      })
      return {
        status: 'none',
        capturedPaymentId: null,
        capturedAmountPaise: null,
        authorizedPaymentId: null,
      }
    }
  }

  async refundCapturedPayment(input: {
    gatewayPaymentId: string
    amountPaise: number
    reason: string
  }): Promise<GatewayRefundResult> {
    if (this.getMode() === 'mock') {
      for (const entry of this.mockOrders.values()) {
        if (entry.capturedPaymentId === input.gatewayPaymentId) {
          entry.refunded = true
        }
      }
      return {
        refunded: true,
        refundId: `rfnd_mock_${input.gatewayPaymentId.slice(-8)}_${randomUUID().slice(0, 8)}`,
      }
    }

    try {
      const res = await fetch(
        `https://api.razorpay.com/v1/payments/${input.gatewayPaymentId}/refund`,
        {
          method: 'POST',
          headers: {
            Authorization: this.getRazorpayAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: input.amountPaise,
            speed: 'normal',
            notes: { reason: input.reason },
          }),
          signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
        },
      )

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return {
          refunded: false,
          refundId: null,
          error: `Gateway refund failed (${res.status}): ${body.slice(0, 200)}`,
        }
      }

      const json = (await res.json()) as { id?: string }
      return {
        refunded: true,
        refundId: json.id ?? null,
      }
    } catch (error) {
      return {
        refunded: false,
        refundId: null,
        error: error instanceof Error ? error.message : 'unknown refund error',
      }
    }
  }
}
