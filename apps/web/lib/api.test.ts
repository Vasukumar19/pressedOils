import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiRequestError,
  createCheckoutOrder,
  failCheckoutPayment,
  fetchLiveAvailability,
  fetchPublicProductBySlug,
  fetchPublicProducts,
  sendOtpCode,
  validateCartOnServer,
  verifyCheckoutPayment,
  verifyOtpCode,
} from './api'
import { canRenderDraftLegalCopy } from './legal'

describe('storefront API client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws ApiRequestError on HTTP 500 rather than swallowing errors so ISR preserves stale cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ message: 'DB error' }), { status: 500 })),
    )

    await expect(fetchPublicProducts({ page: 1, pageSize: 6 })).rejects.toBeInstanceOf(
      ApiRequestError,
    )
    await expect(fetchPublicProductBySlug('groundnut-oil')).rejects.toBeInstanceOf(ApiRequestError)
  })

  it('returns null on HTTP 404 for product detail so Next.js renders notFound()', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ message: 'Not found' }), { status: 404 })),
    )

    await expect(fetchPublicProductBySlug('does-not-exist')).resolves.toBeNull()
  })

  it('fetches live availability with no-store and handles empty input without network calls', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              variantId: '550e8400-e29b-41d4-a716-446655440001',
              inStock: true,
              lowStock: true,
              availableStock: 3,
            },
          ],
          maxOrderQtyPerVariant: 10,
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', spy)

    const empty = await fetchLiveAvailability([])
    expect(empty.items).toEqual([])
    expect(spy).not.toHaveBeenCalled()

    const live = await fetchLiveAvailability(['550e8400-e29b-41d4-a716-446655440001'])
    expect(live.items[0]?.availableStock).toBe(3)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/products/availability?variantIds='),
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('validates cart on server, forwards X-Cart-Session token, and surfaces API error messages', async () => {
    const validResponse = {
      items: [],
      fulfilmentMethod: 'DELIVERY',
      pickup: null,
      pincode: null,
      coupon: null,
      freeShipping: null,
      tax: { showTaxBreakdown: false },
      summary: {
        itemsSubtotalPaise: 0,
        discountPaise: 0,
        netItemsTotalPaise: 0,
        shippingPaise: null,
        shippingStatus: 'ENTER_PINCODE',
        taxAddedPaise: 0,
        totalPaise: 0,
        totalLabel: 'Items total',
        canCheckout: false,
      },
      maxOrderQtyPerVariant: 10,
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { 'x-cart-session': 'sess-123.sig' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: 'Too many invalid coupon attempts. Please try again later.' }),
          { status: 429 },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const ok = await validateCartOnServer(
      { items: [], fulfilmentMethod: 'DELIVERY' },
      { sessionToken: 'prev.tok' },
    )
    expect(ok.nextSessionToken).toBe('sess-123.sig')
    expect(ok.data.summary.totalLabel).toBe('Items total')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/cart/validate'),
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: expect.objectContaining({ 'X-Cart-Session': 'prev.tok' }),
      }),
    )

    await expect(validateCartOnServer({ items: [], fulfilmentMethod: 'DELIVERY' })).rejects.toThrow(
      /Too many invalid coupon attempts/,
    )
  })

  it('sends Idempotency-Key on POST /checkout, parses payment verify & fail contracts, and gates draft legal copy in production', async () => {
    const sampleOrder = {
      id: '550e8400-e29b-41d4-a716-446655440777',
      orderNumber: 'ORD-261125-ABCDE',
      fulfilmentMethod: 'DELIVERY',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      refundedPaise: 0,
      orderStatus: 'COD_PENDING',
      itemsSubtotalPaise: 20000,
      discountPaise: 0,
      netItemsTotalPaise: 20000,
      shippingPaise: 5000,
      codFeePaise: 0,
      taxAddedPaise: 0,
      totalPaise: 25000,
      tax: { showTaxBreakdown: false },
      couponCode: null,
      pickup: null,
      pickupCode: null,
      reservationExpiresAt: null,
      needsAttention: false,
      dpdpPolicyVersion: '2026-11-draft-v1',
      marketingConsent: false,
      createdAt: '2026-11-25T10:00:00.000Z',
      items: [],
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ order: sampleOrder, payment: null }), {
          status: 201,
          headers: { 'x-cart-session': 'sess-new.sig' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            order: { ...sampleOrder, orderStatus: 'PAID', paymentStatus: 'CAPTURED' },
            alreadyProcessed: false,
            autoRefunded: false,
            message: 'Payment confirmed.',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            orderId: sampleOrder.id,
            orderNumber: sampleOrder.orderNumber,
            orderStatus: 'CANCELLED',
            released: true,
            message: 'Reserved stock released cleanly.',
          }),
          { status: 200 },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const placed = await createCheckoutOrder(
      {
        contact: { name: 'Asha', phone: '+919876543210' },
        fulfilmentMethod: 'DELIVERY',
        address: {
          name: 'Asha',
          phone: '+919876543210',
          line1: '12 Main Road',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
        },
        items: [{ variantId: '550e8400-e29b-41d4-a716-446655440001', qty: 1 }],
        paymentMethod: 'COD',
        dpdpConsent: true,
        marketingConsent: false,
      },
      { idempotencyKey: 'test-idempotency-key-1234', sessionToken: 'prev.tok' },
    )
    expect(placed.data.order.orderNumber).toBe('ORD-261125-ABCDE')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': 'test-idempotency-key-1234',
      'X-Cart-Session': 'prev.tok',
    })

    const verified = await verifyCheckoutPayment({
      orderId: sampleOrder.id,
      razorpayOrderId: 'order_123',
      razorpayPaymentId: 'pay_123',
      razorpaySignature: 'sig_123',
    })
    expect(verified.order.orderStatus).toBe('PAID')

    const failed = await failCheckoutPayment({
      orderId: sampleOrder.id,
      orderToken: 'test-checkout-order-token-1234',
      reason: 'MODAL_DISMISSED',
    })
    expect(failed.released).toBe(true)

    const prevAppEnv = process.env.APP_ENV
    process.env.APP_ENV = 'production'
    try {
      expect(
        canRenderDraftLegalCopy({
          brandName: 'Brand',
          currency: 'INR',
          freeShippingEnabled: false,
          freeShippingThresholdPaise: null,
          defaultShippingPaise: 7000,
          gstRateBps: 500,
          gstIncludedInPrice: true,
          showTaxBreakdown: false,
          storePickupEnabled: false,
          payAtStoreEnabled: false,
          pickupLocations: [],
          codEnabled: false,
          codFeePaise: 0,
          codMaxOrderPaise: null,
          legalPagesApproved: false,
          dpdpPolicyVersion: '2026-11-draft-v1',
          autoConfirmPaidOrders: true,
          smsOtpReady: true,
          turnstileSiteKey: null,
          checkoutEnabled: false,
          paymentGateway: 'razorpay',
          fssaiNumber: '123',
          supportEmail: 'a@b.com',
          supportPhone: '+919999999999',
          registeredAddress: 'Chennai',
          maxQtyPerVariant: 10,
          requireLabReportForActivation: true,
          showSampleDataBanner: false,
        }),
      ).toBe(false)
    } finally {
      process.env.APP_ENV = prevAppEnv
    }
  })

  it('sends and verifies OTP tokens and surfaces Turnstile CAPTCHA flag cleanly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challengeId: '550e8400-e29b-41d4-a716-446655440888',
            maskedPhone: '+91******3210',
            expiresAt: '2026-11-25T14:00:00.000Z',
            resendAvailableAt: '2026-11-25T13:55:45.000Z',
            captchaRequired: false,
          }),
          { status: 200, headers: { 'x-cart-session': 'sess-otp.sig' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            verified: true,
            verificationToken: 'ver_tok_1234567890abcdef',
            expiresAt: '2026-11-25T14:15:00.000Z',
          }),
          { status: 200, headers: { 'x-cart-session': 'sess-otp.sig' } },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const sent = await sendOtpCode({ phone: '9876543210', purpose: 'COD_CHECKOUT' })
    expect(sent.data.maskedPhone).toBe('+91******3210')
    expect(sent.nextSessionToken).toBe('sess-otp.sig')

    const verified = await verifyOtpCode(
      {
        challengeId: sent.data.challengeId,
        phone: '9876543210',
        code: '123456',
        purpose: 'COD_CHECKOUT',
      },
      { sessionToken: sent.nextSessionToken ?? undefined },
    )
    expect(verified.data.verified).toBe(true)
    expect(verified.data.verificationToken).toBe('ver_tok_1234567890abcdef')
  })
})
