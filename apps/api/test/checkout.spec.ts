import { HttpException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { CHECKOUT_RATE_LIMITS } from '@pressedoils/shared'
import { env } from '../src/env'
import { CheckoutRateLimitService } from '../src/checkout/checkout-rate-limit.service'
import { CheckoutSecurityService } from '../src/checkout/checkout-security.service'
import { computeRazorpayHmac, PaymentGatewayService } from '../src/checkout/payment-gateway.service'
import type { RedisService } from '../src/redis/redis.service'
import { ResilientThrottlerStorage } from '../src/redis/resilient-throttler.storage'

describe('PaymentGatewayService security & signature verification', () => {
  it('refuses instantiation if mock gateway is configured in production runtime', () => {
    const prevAppEnv = env.APP_ENV
    const prevGateway = env.PAYMENT_GATEWAY
    env.APP_ENV = 'production'
    env.PAYMENT_GATEWAY = 'mock'
    try {
      expect(() => new PaymentGatewayService()).toThrow(/Mock payment gateway/i)
    } finally {
      env.APP_ENV = prevAppEnv
      env.PAYMENT_GATEWAY = prevGateway
    }
  })

  it('verifies Razorpay HMAC signatures with constant-time compare and rejects tampering', async () => {
    const prevGateway = env.PAYMENT_GATEWAY
    const prevKeyId = env.RAZORPAY_KEY_ID
    const prevSecret = env.RAZORPAY_KEY_SECRET
    env.PAYMENT_GATEWAY = 'razorpay'
    env.RAZORPAY_KEY_ID = 'rzp_test_unit'
    env.RAZORPAY_KEY_SECRET = 'unit_secret_xyz'

    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'order_rzp_unit_01' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    try {
      const gateway = new PaymentGatewayService()
      const created = await gateway.createOrder({
        orderId: '550e8400-e29b-41d4-a716-446655440001',
        orderNumber: 'ORD-261125-AB23C',
        amountPaise: 50000,
      })

      expect(created.gateway).toBe('razorpay')
      expect(created.gatewayOrderId).toBe('order_rzp_unit_01')
      const reqBody = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body))
      expect(reqBody.payment_capture).toBe(1)
      expect(reqBody.amount).toBe(50000)

      const validSig = computeRazorpayHmac('order_rzp_unit_01', 'pay_rzp_01', 'unit_secret_xyz')
      expect(
        gateway.verifyPaymentSignature({
          razorpayOrderId: 'order_rzp_unit_01',
          razorpayPaymentId: 'pay_rzp_01',
          razorpaySignature: validSig,
        }),
      ).toBe(true)

      expect(
        gateway.verifyPaymentSignature({
          razorpayOrderId: 'order_rzp_unit_01',
          razorpayPaymentId: 'pay_rzp_01',
          razorpaySignature: `${validSig.slice(0, -2)}ff`,
        }),
      ).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      env.PAYMENT_GATEWAY = prevGateway
      env.RAZORPAY_KEY_ID = prevKeyId
      env.RAZORPAY_KEY_SECRET = prevSecret
    }
  })
})

describe('CheckoutSecurityService', () => {
  it('generates ORD-YYMMDD-XXXXX numbers without ambiguous characters', () => {
    const sec = new CheckoutSecurityService()
    for (let i = 0; i < 20; i += 1) {
      const num = sec.generateOrderNumber(new Date('2026-11-25T12:00:00.000Z'))
      expect(num).toMatch(/^ORD-261125-[2-9A-HJ-NP-Z]{5}$/)
    }
  })

  it('creates server-keyed HMAC pickup codes without storing plaintext', () => {
    const sec = new CheckoutSecurityService()
    const orderId = '550e8400-e29b-41d4-a716-446655440009'
    const { plaintextCode, hmacHash } = sec.createPickupCodePair(orderId)

    expect(plaintextCode).toMatch(/^\d{6}$/)
    expect(hmacHash).toHaveLength(64)
    expect(sec.verifyPickupCode(orderId, plaintextCode, hmacHash)).toBe(true)
    expect(sec.verifyPickupCode(orderId, '000000', hmacHash)).toBe(false)
    expect(
      sec.verifyPickupCode('550e8400-e29b-41d4-a716-446655440010', plaintextCode, hmacHash),
    ).toBe(false)
  })

  it('produces identical request hash regardless of duplicate/unsorted cart items', () => {
    const sec = new CheckoutSecurityService()
    const h1 = sec.computeCheckoutRequestHash({
      contact: { name: 'Asha', phone: '+919876543210' },
      fulfilmentMethod: 'DELIVERY',
      address: {
        name: 'Asha',
        phone: '+919876543210',
        line1: '12 Main Rd',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
      },
      items: [
        { variantId: '550e8400-e29b-41d4-a716-446655440002', qty: 1 },
        { variantId: '550e8400-e29b-41d4-a716-446655440001', qty: 2 },
      ],
      paymentMethod: 'COD',
      dpdpConsent: true,
      marketingConsent: false,
    })

    const h2 = sec.computeCheckoutRequestHash({
      contact: { name: 'Asha', phone: '+919876543210' },
      fulfilmentMethod: 'DELIVERY',
      address: {
        name: 'Asha',
        phone: '+919876543210',
        line1: '12 Main Rd',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
      },
      items: [
        { variantId: '550e8400-e29b-41d4-a716-446655440001', qty: 1 },
        { variantId: '550e8400-e29b-41d4-a716-446655440002', qty: 1 },
        { variantId: '550e8400-e29b-41d4-a716-446655440001', qty: 1 },
      ],
      paymentMethod: 'COD',
      dpdpConsent: true,
      marketingConsent: false,
    })

    expect(h1).toBe(h2)
  })
})

describe('CheckoutRateLimitService', () => {
  it('enforces strict checkout limits and falls back to memory when Redis fails', async () => {
    const redisDown = {
      incrRateLimit: vi.fn().mockResolvedValue(null),
      getString: vi.fn().mockResolvedValue(null),
    } as unknown as RedisService
    const storage = new ResilientThrottlerStorage(redisDown)
    const limiter = new CheckoutRateLimitService(storage)
    const sess = { sessionId: '550e8400-e29b-41d4-a716-446655440998', token: 't', isNew: false }

    for (let i = 0; i < CHECKOUT_RATE_LIMITS.SESSION_PER_MIN; i += 1) {
      await limiter.enforceCreateRateLimit('198.51.100.1', sess)
    }
    await expect(limiter.enforceCreateRateLimit('198.51.100.1', sess)).rejects.toBeInstanceOf(
      HttpException,
    )
  })
})
