'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  checkoutRequestSchema,
  type CheckoutResponseDto,
  formatPaiseToInr,
  FULFILMENT_METHOD,
  PAYMENT_METHOD,
  type PaymentMethod,
} from '@pressedoils/shared'
import { AlertCircle, ArrowLeft, Clock, Lock, MapPin, Store, Tag } from 'lucide-react'
import {
  ApiRequestError,
  createCheckoutOrder,
  failCheckoutPayment,
  mockCompleteCheckoutPayment,
  verifyCheckoutPayment,
} from '@/lib/api'
import { useCart } from '@/lib/cart'
import { setLastConfirmedOrder } from '@/lib/checkout-handoff'
import { PriceBreakdown } from './price-breakdown'

const MockPaymentModal =
  process.env.NEXT_PUBLIC_APP_ENV !== 'production'
    ? dynamic(() => import('./mock-payment-modal'), { ssr: false })
    : null

interface RazorpayHandlerResponse {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

interface RazorpayCheckoutInstance {
  open: () => void
  on: (event: string, handler: (err: { error?: { description?: string } }) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckoutInstance
  }
}

function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Razorpay) return Promise.resolve(true)

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
    )
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve(Boolean(window.Razorpay))
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000))
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function CheckoutClient() {
  const router = useRouter()
  const {
    items,
    lines,
    clear,
    maxOrderQtyPerVariant,
    storePickupEnabled,
    payAtStoreEnabled,
    pickupLocations,
    codEnabled,
    codFeePaise,
    codMaxOrderPaise,
    dpdpPolicyVersion,
    checkoutEnabled,
    paymentGateway,
    getSessionToken,
    setSessionToken,
    fulfilmentMethod,
    setFulfilmentMethod,
    pickupLocationId,
    setPickupLocationId,
    pincode,
    setPincode,
    couponCode,
    setCouponCode,
    validation,
    isValidating,
    revalidateCartNow,
    hasUnresolvedItems,
  } = useCart()

  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [stateName, setStateName] = useState('')
  const [pincodeInput, setPincodeInput] = useState(pincode)

  const [couponInput, setCouponInput] = useState(couponCode)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PAYMENT_METHOD.ONLINE)
  // Consent checkboxes strictly default to unticked
  const [dpdpConsent, setDpdpConsent] = useState(false)
  const [marketingConsent, setMarketingConsent] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [verifyingPayment, setVerifyingPayment] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingSession, setPendingSession] = useState<CheckoutResponseDto | null>(null)
  const [showMockModal, setShowMockModal] = useState(false)
  const [countdownMs, setCountdownMs] = useState<number | null>(null)

  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
  )

  const regenerateIdempotencyKey = useCallback(() => {
    idempotencyKeyRef.current =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  }, [])

  useEffect(() => {
    setPincodeInput(pincode)
  }, [pincode])

  useEffect(() => {
    setCouponInput(couponCode)
  }, [couponCode])

  // Auto-fill City/State cleanly when serviceable pincode resolves if empty
  useEffect(() => {
    if (validation?.pincode?.serviceable) {
      setCity((prev) => prev || validation.pincode?.city || '')
      setStateName((prev) => prev || validation.pincode?.state || '')
    }
  }, [validation?.pincode])

  // Keep reservation countdown timer ticking during open online payment session
  useEffect(() => {
    const expiryIso = pendingSession?.payment?.reservationExpiresAt
    if (!expiryIso) {
      setCountdownMs(null)
      return
    }
    const update = () => {
      const remaining = new Date(expiryIso).getTime() - Date.now()
      setCountdownMs(remaining > 0 ? remaining : 0)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [pendingSession?.payment?.reservationExpiresAt])

  // Determine whether COD / Pay-at-store is eligible for current order context
  const codEligibility = useMemo(() => {
    if (fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP) {
      if (!payAtStoreEnabled) {
        return { allowed: false, reason: 'Pay at store is not enabled.' }
      }
      return { allowed: true, reason: null }
    }
    if (!codEnabled) {
      return { allowed: false, reason: 'Cash on Delivery is currently unavailable.' }
    }
    if (validation?.pincode && validation.pincode.serviceable && !validation.pincode.codAllowed) {
      return {
        allowed: false,
        reason: `Cash on Delivery is not available for pincode ${validation.pincode.pincode}.`,
      }
    }
    const totalWithCodFee = (validation?.summary.totalPaise ?? 0) + codFeePaise
    if (codMaxOrderPaise !== null && totalWithCodFee > codMaxOrderPaise) {
      return {
        allowed: false,
        reason: `Cash on Delivery is available up to ${formatPaiseToInr(codMaxOrderPaise)}.`,
      }
    }
    return { allowed: true, reason: null }
  }, [codEnabled, codFeePaise, codMaxOrderPaise, fulfilmentMethod, payAtStoreEnabled, validation])

  useEffect(() => {
    if (paymentMethod === PAYMENT_METHOD.COD && !codEligibility.allowed) {
      setPaymentMethod(PAYMENT_METHOD.ONLINE)
    }
  }, [codEligibility.allowed, paymentMethod])

  const appliedCodFeePaise =
    paymentMethod === PAYMENT_METHOD.COD &&
    fulfilmentMethod === FULFILMENT_METHOD.DELIVERY &&
    codEligibility.allowed
      ? codFeePaise
      : 0

  function handlePincodeChange(raw: string) {
    const digitsOnly = raw.replace(/\D/g, '').slice(0, 6)
    setPincodeInput(digitsOnly)
    if (digitsOnly.length === 6 && /^[1-9][0-9]{5}$/.test(digitsOnly)) {
      setPincode(digitsOnly)
      void revalidateCartNow({ pincode: digitsOnly })
    } else if (digitsOnly.length === 0 && pincode !== '') {
      setPincode('')
      void revalidateCartNow({ pincode: '' })
    }
  }

  function handleApplyCoupon(e: FormEvent) {
    e.preventDefault()
    const normalized = couponInput.trim().toUpperCase()
    setCouponCode(normalized)
    regenerateIdempotencyKey()
    void revalidateCartNow({ couponCode: normalized })
  }

  function handleClearCoupon() {
    setCouponInput('')
    setCouponCode('')
    regenerateIdempotencyKey()
    void revalidateCartNow({ couponCode: '' })
  }

  const completeNavigationToSuccess = useCallback(
    (order: CheckoutResponseDto['order']) => {
      setLastConfirmedOrder(order)
      clear()
      regenerateIdempotencyKey()
      router.push(`/checkout/success?order=${encodeURIComponent(order.orderNumber)}`)
    },
    [clear, regenerateIdempotencyKey, router],
  )

  const handleReleasePendingSession = useCallback(
    async (reason: 'PAYMENT_FAILED' | 'MODAL_DISMISSED' | 'CANCELLED', description?: string) => {
      if (!pendingSession) return
      const orderId = pendingSession.order.id
      setShowMockModal(false)
      setPendingSession(null)
      try {
        await failCheckoutPayment({
          orderId,
          reason,
          ...(description ? { errorDescription: description } : {}),
        })
      } catch {
        // Best-effort UI cleanup; server reservation expiry covers lost signals
      }
      regenerateIdempotencyKey()
      void revalidateCartNow()
      setErrorMessage(
        description ??
          (reason === 'PAYMENT_FAILED'
            ? 'Payment did not go through and reserved stock has been released. Your bag is intact so you can retry.'
            : 'Payment was cancelled and reserved stock has been released. You can edit your bag or retry below.'),
      )
    },
    [pendingSession, regenerateIdempotencyKey, revalidateCartNow],
  )

  async function launchRazorpayModal(checkoutResp: CheckoutResponseDto) {
    const payment = checkoutResp.payment
    if (!payment) return

    const loaded = await loadRazorpayScript()
    if (!loaded || !window.Razorpay) {
      await failCheckoutPayment({
        orderId: checkoutResp.order.id,
        reason: 'PAYMENT_FAILED',
        errorDescription: 'Razorpay checkout script failed to load',
      }).catch(() => undefined)
      regenerateIdempotencyKey()
      setPendingSession(null)
      setErrorMessage('Unable to load payment gateway script. Please check your network and retry.')
      return
    }

    const rzp = new window.Razorpay({
      key: payment.keyId,
      amount: payment.amountPaise,
      currency: payment.currency,
      name: payment.brandName,
      description: `Order ${checkoutResp.order.orderNumber}`,
      order_id: payment.gatewayOrderId,
      prefill: payment.prefill,
      theme: { color: '#1F3A2E' },
      handler: async (res: RazorpayHandlerResponse) => {
        setVerifyingPayment(true)
        try {
          const verified = await verifyCheckoutPayment({
            orderId: checkoutResp.order.id,
            razorpayOrderId: res.razorpay_order_id,
            razorpayPaymentId: res.razorpay_payment_id,
            razorpaySignature: res.razorpay_signature,
          })
          setPendingSession(null)
          completeNavigationToSuccess(verified.order)
        } catch (err) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'Payment verification encountered an issue. If deducted, our reconciliation check will process or refund automatically.',
          )
        } finally {
          setVerifyingPayment(false)
        }
      },
      modal: {
        ondismiss: () => {
          void handleReleasePendingSession('MODAL_DISMISSED')
        },
      },
    })

    rzp.on('payment.failed', (evt) => {
      void handleReleasePendingSession('PAYMENT_FAILED', evt.error?.description)
    })

    rzp.open()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting || verifyingPayment) return
    setErrorMessage(null)

    const payloadCandidate = {
      contact: {
        name: contactName.trim(),
        phone: contactPhone.trim(),
        ...(contactEmail.trim() ? { email: contactEmail.trim() } : {}),
      },
      fulfilmentMethod,
      ...(fulfilmentMethod === FULFILMENT_METHOD.DELIVERY
        ? {
            address: {
              name: contactName.trim(),
              phone: contactPhone.trim(),
              line1: addressLine1.trim(),
              ...(addressLine2.trim() ? { line2: addressLine2.trim() } : {}),
              city: city.trim(),
              state: stateName.trim(),
              pincode: pincodeInput.trim(),
            },
          }
        : {
            ...(pickupLocationId ? { pickupLocationId } : {}),
          }),
      items: items.map((i) => ({
        variantId: i.variantId,
        qty: Math.min(i.qty, maxOrderQtyPerVariant),
      })),
      paymentMethod,
      ...(couponCode.trim() ? { couponCode: couponCode.trim().toUpperCase() } : {}),
      dpdpConsent,
      marketingConsent,
    }

    const parsed = checkoutRequestSchema.safeParse(payloadCandidate)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      setErrorMessage(firstIssue?.message ?? 'Please review the highlighted details and try again.')
      return
    }

    setSubmitting(true)
    try {
      const { data, nextSessionToken } = await createCheckoutOrder(parsed.data, {
        idempotencyKey: idempotencyKeyRef.current,
        sessionToken: getSessionToken(),
      })
      if (nextSessionToken) {
        setSessionToken(nextSessionToken)
      }

      if (data.payment === null) {
        completeNavigationToSuccess(data.order)
        return
      }

      setPendingSession(data)
      if (
        process.env.NEXT_PUBLIC_APP_ENV !== 'production' &&
        data.payment.gateway === 'mock' &&
        MockPaymentModal
      ) {
        setShowMockModal(true)
      } else {
        await launchRazorpayModal(data)
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        regenerateIdempotencyKey()
      }
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to place your order right now. Please retry.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMockSimulateSuccess() {
    if (!pendingSession || verifyingPayment) return
    setVerifyingPayment(true)
    try {
      const verified = await mockCompleteCheckoutPayment(pendingSession.order.id)
      setShowMockModal(false)
      setPendingSession(null)
      completeNavigationToSuccess(verified.order)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Test payment verification failed.')
    } finally {
      setVerifyingPayment(false)
    }
  }

  if (!checkoutEnabled) {
    return (
      <section className="mx-auto max-w-2xl px-5 py-20 text-center">
        <div className="border-gold/40 bg-champagne/50 border p-8 sm:p-10">
          <Lock className="text-bronze mx-auto size-8" aria-hidden />
          <h1 className="mt-4 font-serif text-4xl font-medium">Checkout opening soon</h1>
          <p className="text-sage mt-3 text-sm leading-relaxed">
            Checkout in production stays disabled until our privacy, terms, and shipping policies
            have received final owner approval.
          </p>
          <Link
            href="/shop"
            className="bg-forest text-ivory hover:bg-ink mt-7 inline-flex min-h-12 items-center px-8 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
          >
            Back to shop
          </Link>
        </div>
      </section>
    )
  }

  if (lines.length === 0 && !hasUnresolvedItems) {
    return (
      <section className="mx-auto max-w-2xl px-5 py-20 text-center">
        <h1 className="font-serif text-4xl font-medium">Your bag is empty.</h1>
        <p className="text-sage mt-3 text-sm">
          Add freshly pressed oil bottles to your bag before checking out.
        </p>
        <Link
          href="/shop"
          className="bg-forest text-ivory hover:bg-ink mt-7 inline-flex min-h-12 items-center px-8 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
        >
          Explore the oils
        </Link>
      </section>
    )
  }

  const hasBlockingItemIssue = (validation?.items ?? []).some(
    (item) =>
      item.status === 'OUT_OF_STOCK' ||
      item.status === 'UNAVAILABLE' ||
      item.status === 'QUANTITY_UNAVAILABLE',
  )

  return (
    <div className="mx-auto max-w-[1400px] px-5 pt-28 pb-20 md:px-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/shop"
            className="text-sage hover:text-forest inline-flex min-h-11 items-center gap-2 text-xs font-semibold tracking-[0.18em] uppercase transition-colors"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Continue shopping
          </Link>
          <h1 className="mt-1 font-serif text-4xl font-medium sm:text-5xl">Checkout</h1>
        </div>
        {countdownMs !== null && pendingSession ? (
          <div
            role="status"
            className="border-gold/50 bg-champagne flex items-center gap-2 border px-4 py-2.5 text-xs font-medium tabular-nums"
          >
            <Clock className="text-bronze size-4" aria-hidden />
            Stock held for {formatCountdown(countdownMs)}
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="border-error/40 bg-error-bg text-error mb-6 flex items-start gap-3 border p-4 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{errorMessage}</p>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-12">
        {/* Checkout Form Column */}
        <form onSubmit={handleSubmit} noValidate className="space-y-8 lg:col-span-7">
          {/* Step 1: Contact */}
          <fieldset className="border-forest/15 bg-ivory space-y-4 border p-5 sm:p-7">
            <legend className="text-bronze px-1 text-xs font-semibold tracking-[0.22em] uppercase">
              1. Contact details
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label
                  htmlFor="checkout-name"
                  className="text-sage block text-[11px] font-semibold tracking-[0.18em] uppercase"
                >
                  Full name
                </label>
                <input
                  id="checkout-name"
                  type="text"
                  required
                  autoComplete="name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Enter your full name"
                  className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 w-full border px-3.5 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="checkout-phone"
                  className="text-sage block text-[11px] font-semibold tracking-[0.18em] uppercase"
                >
                  Indian mobile number
                </label>
                <input
                  id="checkout-phone"
                  type="tel"
                  required
                  autoComplete="tel-national"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="10-digit mobile (e.g. 9876543210)"
                  className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 w-full border px-3.5 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="checkout-email"
                  className="text-sage block text-[11px] font-semibold tracking-[0.18em] uppercase"
                >
                  Email <span className="font-normal normal-case">(optional receipt)</span>
                </label>
                <input
                  id="checkout-email"
                  type="email"
                  autoComplete="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 w-full border px-3.5 text-sm"
                />
              </div>
            </div>
          </fieldset>

          {/* Step 2: Delivery or Store Pickup */}
          <fieldset className="border-forest/15 bg-ivory space-y-5 border p-5 sm:p-7">
            <legend className="text-bronze px-1 text-xs font-semibold tracking-[0.22em] uppercase">
              2. Fulfilment
            </legend>

            {storePickupEnabled && pickupLocations.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setFulfilmentMethod(FULFILMENT_METHOD.DELIVERY)
                    regenerateIdempotencyKey()
                  }}
                  className={`flex min-h-12 items-center justify-center gap-2 border px-4 text-xs font-semibold tracking-[0.16em] uppercase transition-colors ${
                    fulfilmentMethod === FULFILMENT_METHOD.DELIVERY
                      ? 'border-forest bg-forest text-ivory'
                      : 'border-forest/30 text-forest hover:border-forest'
                  }`}
                >
                  <MapPin className="size-4" aria-hidden />
                  Home delivery
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextId = pickupLocationId ?? pickupLocations[0]?.id
                    setFulfilmentMethod(FULFILMENT_METHOD.STORE_PICKUP)
                    if (nextId) setPickupLocationId(nextId)
                    regenerateIdempotencyKey()
                  }}
                  className={`flex min-h-12 items-center justify-center gap-2 border px-4 text-xs font-semibold tracking-[0.16em] uppercase transition-colors ${
                    fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP
                      ? 'border-forest bg-forest text-ivory'
                      : 'border-forest/30 text-forest hover:border-forest'
                  }`}
                >
                  <Store className="size-4" aria-hidden />
                  Store pickup (₹0)
                </button>
              </div>
            ) : null}

            {fulfilmentMethod === FULFILMENT_METHOD.DELIVERY ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="checkout-pincode"
                    className="text-sage block text-[11px] font-semibold tracking-[0.18em] uppercase"
                  >
                    Pincode
                  </label>
                  <input
                    id="checkout-pincode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={pincodeInput}
                    onChange={(e) => handlePincodeChange(e.target.value)}
                    placeholder="e.g. 600001"
                    className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 w-full border px-3.5 font-mono text-sm"
                  />
                  {validation?.pincode ? (
                    validation.pincode.serviceable ? (
                      <p className="text-success text-xs">
                        Serviceable · {validation.pincode.deliveryDays}{' '}
                        {validation.pincode.deliveryDays === 1 ? 'day' : 'days'}
                        {validation.pincode.codAllowed ? ' · COD available' : ' · Prepaid only'}
                      </p>
                    ) : (
                      <p className="text-error text-xs">
                        Delivery is not yet serviceable for {validation.pincode.pincode}.
                      </p>
                    )
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="checkout-city"
                    className="text-sage block text-[11px] font-semibold tracking-[0.18em] uppercase"
                  >
                    City
                  </label>
                  <input
                    id="checkout-city"
                    type="text"
                    required
                    autoComplete="address-level2"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City"
                    className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 w-full border px-3.5 text-sm"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label
                    htmlFor="checkout-line1"
                    className="text-sage block text-[11px] font-semibold tracking-[0.18em] uppercase"
                  >
                    Street address &amp; house / flat no.
                  </label>
                  <input
                    id="checkout-line1"
                    type="text"
                    required
                    autoComplete="address-line1"
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    placeholder="House / flat number, street name"
                    className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 w-full border px-3.5 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="checkout-line2"
                    className="text-sage block text-[11px] font-semibold tracking-[0.18em] uppercase"
                  >
                    Landmark / area <span className="font-normal normal-case">(optional)</span>
                  </label>
                  <input
                    id="checkout-line2"
                    type="text"
                    autoComplete="address-line2"
                    value={addressLine2}
                    onChange={(e) => setAddressLine2(e.target.value)}
                    placeholder="Apartment, landmark"
                    className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 w-full border px-3.5 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="checkout-state"
                    className="text-sage block text-[11px] font-semibold tracking-[0.18em] uppercase"
                  >
                    State
                  </label>
                  <input
                    id="checkout-state"
                    type="text"
                    required
                    autoComplete="address-level1"
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                    placeholder="State"
                    className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 w-full border px-3.5 text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="border-gold/35 bg-champagne/45 space-y-2 border p-4 text-xs">
                {pickupLocations.length > 1 ? (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="checkout-pickup-location"
                      className="text-sage block text-[11px] font-semibold tracking-[0.16em] uppercase"
                    >
                      Select pickup store
                    </label>
                    <select
                      id="checkout-pickup-location"
                      value={pickupLocationId ?? pickupLocations[0]?.id ?? ''}
                      onChange={(e) => setPickupLocationId(e.target.value)}
                      className="border-forest/30 bg-ivory text-forest min-h-11 w-full border px-3 text-xs"
                    >
                      {pickupLocations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {(validation?.pickup?.location ?? pickupLocations[0]) ? (
                  <>
                    <p className="text-forest font-semibold">
                      {(validation?.pickup?.location ?? pickupLocations[0])!.name}
                    </p>
                    <p className="text-ink/80">
                      {(validation?.pickup?.location ?? pickupLocations[0])!.address}
                    </p>
                    <p className="text-sage">
                      Hours: {(validation?.pickup?.location ?? pickupLocations[0])!.hours}
                    </p>
                    {validation?.pickup ? (
                      <p className="text-success font-medium">
                        Estimated ready: {validation.pickup.estimatedReadyDisplay}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            )}
          </fieldset>

          {/* Step 3: Payment Method */}
          <fieldset className="border-forest/15 bg-ivory space-y-4 border p-5 sm:p-7">
            <legend className="text-bronze px-1 text-xs font-semibold tracking-[0.22em] uppercase">
              3. Payment method
            </legend>

            <div className="space-y-3">
              <label
                className={`flex min-h-14 cursor-pointer items-start gap-3 border p-4 transition-colors ${
                  paymentMethod === PAYMENT_METHOD.ONLINE
                    ? 'border-forest bg-champagne/45'
                    : 'border-forest/25 hover:border-forest'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === PAYMENT_METHOD.ONLINE}
                  onChange={() => {
                    setPaymentMethod(PAYMENT_METHOD.ONLINE)
                    regenerateIdempotencyKey()
                  }}
                  className="accent-forest mt-1 size-4 shrink-0"
                />
                <div className="space-y-0.5 text-sm">
                  <p className="font-medium">
                    Pay Online (UPI, Cards, Netbanking)
                    {paymentGateway === 'mock' ? (
                      <span className="border-gold/50 bg-champagne text-bronze ml-2 border px-1.5 py-0.5 text-[10px] tracking-[0.14em] uppercase">
                        Dev simulator
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sage text-xs">
                    Reserves stock for 15 minutes while you finish payment via Razorpay.
                  </p>
                </div>
              </label>

              {fulfilmentMethod === FULFILMENT_METHOD.DELIVERY || payAtStoreEnabled ? (
                <label
                  className={`flex min-h-14 items-start gap-3 border p-4 transition-colors ${
                    !codEligibility.allowed
                      ? 'border-forest/15 bg-sand/50 cursor-not-allowed opacity-65'
                      : paymentMethod === PAYMENT_METHOD.COD
                        ? 'border-forest bg-champagne/45 cursor-pointer'
                        : 'border-forest/25 hover:border-forest cursor-pointer'
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    disabled={!codEligibility.allowed}
                    checked={paymentMethod === PAYMENT_METHOD.COD}
                    onChange={() => {
                      setPaymentMethod(PAYMENT_METHOD.COD)
                      regenerateIdempotencyKey()
                    }}
                    className="accent-forest mt-1 size-4 shrink-0"
                  />
                  <div className="space-y-0.5 text-sm">
                    <p className="font-medium">
                      {fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP
                        ? 'Pay at store'
                        : 'Cash on Delivery'}
                    </p>
                    <p className="text-sage text-xs">
                      {codEligibility.allowed
                        ? appliedCodFeePaise > 0
                          ? `Includes ${formatPaiseToInr(appliedCodFeePaise)} COD handling fee.`
                          : 'No extra COD fee. Confirmed immediately.'
                        : codEligibility.reason}
                    </p>
                  </div>
                </label>
              ) : null}
            </div>
          </fieldset>

          {/* Consent checkboxes (unticked by default) */}
          <div className="border-forest/15 bg-ivory space-y-3 border p-5 sm:p-6">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-relaxed">
              <input
                type="checkbox"
                checked={dpdpConsent}
                onChange={(e) => setDpdpConsent(e.target.checked)}
                className="accent-forest mt-0.5 size-5 shrink-0"
              />
              <span>
                I consent to processing my order details under the{' '}
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bronze underline underline-offset-4"
                >
                  Privacy Policy
                </Link>{' '}
                ({dpdpPolicyVersion}),{' '}
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bronze underline underline-offset-4"
                >
                  Terms
                </Link>
                , and{' '}
                <Link
                  href="/shipping-returns"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bronze underline underline-offset-4"
                >
                  Shipping Policy
                </Link>{' '}
                <span className="text-error">*</span>
              </span>
            </label>

            <label className="text-sage flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-relaxed">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                className="accent-forest mt-0.5 size-5 shrink-0"
              />
              <span>
                Send me optional fresh-press batch announcements and seasonal harvests (you can opt
                out anytime).
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting || verifyingPayment || hasBlockingItemIssue || isValidating}
            className="bg-forest text-ivory hover:bg-ink min-h-13 w-full px-6 text-xs font-semibold tracking-[0.22em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting
              ? 'Processing order…'
              : verifyingPayment
                ? 'Confirming payment…'
                : paymentMethod === PAYMENT_METHOD.ONLINE
                  ? 'Continue to payment'
                  : fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP
                    ? 'Confirm store pickup order'
                    : 'Place COD order'}
          </button>
        </form>

        {/* Order Summary Column */}
        <aside className="lg:col-span-5">
          <div className="border-forest/15 bg-champagne/40 sticky top-24 space-y-6 border p-5 sm:p-7">
            <h2 className="font-serif text-3xl font-medium">Order summary</h2>

            <ul className="divide-forest/15 divide-y">
              {lines.map((line) => (
                <li key={line.variantId} className="flex gap-3.5 py-4">
                  <div className="bg-sand relative h-18 w-14 shrink-0 overflow-hidden">
                    {line.imageUrl ? (
                      <Image
                        src={line.imageUrl}
                        alt={line.imageAlt}
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-serif text-lg leading-tight font-medium">
                      {line.productName}
                    </p>
                    <p className="text-sage text-xs">
                      {line.sizeLabel} · Qty {line.qty}
                    </p>
                  </div>
                  <p className="text-sm font-medium tabular-nums">
                    {formatPaiseToInr(line.lineTotalPaise)}
                  </p>
                </li>
              ))}
            </ul>

            <form onSubmit={handleApplyCoupon} noValidate className="space-y-2">
              <label
                htmlFor="checkout-coupon"
                className="text-sage flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.18em] uppercase"
              >
                <Tag className="size-3.5" aria-hidden />
                Coupon code
              </label>
              <div className="flex gap-2">
                <input
                  id="checkout-coupon"
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  placeholder="Enter code"
                  className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 min-w-0 flex-1 border px-3 font-mono text-sm uppercase"
                />
                {couponCode ? (
                  <button
                    type="button"
                    onClick={handleClearCoupon}
                    className="border-forest/30 text-sage hover:text-forest min-h-11 shrink-0 border px-4 text-xs font-semibold tracking-[0.16em] uppercase"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="border-forest/30 text-forest hover:border-forest min-h-11 shrink-0 border px-4 text-xs font-semibold tracking-[0.16em] uppercase transition-colors"
                  >
                    Apply
                  </button>
                )}
              </div>
              {validation?.coupon ? (
                <p
                  role="status"
                  className={`text-xs ${validation.coupon.applied ? 'text-success' : 'text-error'}`}
                >
                  {validation.coupon.message}
                </p>
              ) : null}
            </form>

            {validation ? (
              <PriceBreakdown validation={validation} codFeePaise={appliedCodFeePaise} />
            ) : null}
          </div>
        </aside>
      </div>

      {showMockModal && pendingSession && pendingSession.payment && MockPaymentModal ? (
        <MockPaymentModal
          orderNumber={pendingSession.order.orderNumber}
          amountPaise={pendingSession.payment.amountPaise}
          isProcessing={verifyingPayment}
          onSimulateSuccess={() => void handleMockSimulateSuccess()}
          onSimulateFailure={() =>
            void handleReleasePendingSession(
              'PAYMENT_FAILED',
              'Simulated payment declined. Reserved stock released and your bag stays ready to retry.',
            )
          }
          onDismiss={() => void handleReleasePendingSession('MODAL_DISMISSED')}
        />
      ) : null}
    </div>
  )
}
