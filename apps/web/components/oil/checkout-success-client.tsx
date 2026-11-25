'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  type CheckoutOrderSummaryDto,
  formatPaiseToInr,
  FULFILMENT_METHOD,
} from '@pressedoils/shared'
import { CheckCircle2, Store, Truck } from 'lucide-react'
import { clearLastConfirmedOrder, getLastConfirmedOrder } from '@/lib/checkout-handoff'

export function CheckoutSuccessClient() {
  const searchParams = useSearchParams()
  const orderNumberParam = searchParams.get('order') ?? undefined
  const [order, setOrder] = useState<CheckoutOrderSummaryDto | null>(null)

  useEffect(() => {
    const resolved = getLastConfirmedOrder(orderNumberParam)
    if (resolved) {
      setOrder(resolved)
    }
    return () => {
      // Clear ephemeral receipt when leaving confirmation view
      clearLastConfirmedOrder()
    }
  }, [orderNumberParam])

  if (!order) {
    return (
      <section className="mx-auto max-w-2xl px-5 pt-32 pb-20 text-center">
        <CheckCircle2 className="text-success mx-auto size-10" aria-hidden />
        <h1 className="mt-4 font-serif text-4xl font-medium">Order received</h1>
        {orderNumberParam ? (
          <p className="mt-2 font-mono text-sm font-medium">{orderNumberParam}</p>
        ) : null}
        <p className="text-sage mt-3 text-sm leading-relaxed">
          Your order confirmation details are not cached in browser storage for your privacy. Full
          SMS/email updates and OTP-protected order tracking arrive in upcoming phases.
        </p>
        <Link
          href="/shop"
          className="bg-forest text-ivory hover:bg-ink mt-8 inline-flex min-h-12 items-center px-8 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
        >
          Back to shop
        </Link>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-3xl px-5 pt-32 pb-20">
      <div className="border-forest/15 bg-ivory border p-6 sm:p-10">
        <div className="border-forest/15 flex flex-wrap items-center justify-between gap-4 border-b pb-6">
          <div>
            <p className="text-success flex items-center gap-2 text-xs font-semibold tracking-[0.2em] uppercase">
              <CheckCircle2 className="size-4" aria-hidden />
              {order.orderStatus === 'PAID'
                ? 'Payment confirmed'
                : order.fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP
                  ? 'Store pickup confirmed'
                  : 'COD order placed'}
            </p>
            <h1 className="mt-2 font-serif text-4xl font-medium">Thank you for your order</h1>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sage text-[11px] tracking-[0.16em] uppercase">Order number</p>
            <p className="mt-1 font-mono text-base font-semibold">{order.orderNumber}</p>
          </div>
        </div>

        {order.pickup ? (
          <div className="border-forest/15 bg-champagne/35 mt-6 space-y-2 border p-4 text-xs">
            <p className="text-forest flex items-center gap-1.5 font-semibold">
              <Store className="size-4" aria-hidden />
              {order.pickup.location.name}
            </p>
            <p className="text-ink/80">{order.pickup.location.address}</p>
            <p className="text-sage">Hours: {order.pickup.location.hours}</p>
            <p className="text-success font-medium">
              Estimated ready: {order.pickup.estimatedReadyDisplay}
            </p>
            <p className="border-gold/40 bg-champagne/70 text-forest mt-2 border px-3 py-2 font-medium">
              We&apos;ll send your pickup code by SMS and email when your order is ready.
            </p>
          </div>
        ) : (
          <div className="border-forest/15 bg-champagne/35 mt-6 flex items-center gap-2.5 border p-4 text-xs">
            <Truck className="text-bronze size-4 shrink-0" aria-hidden />
            <p className="text-ink/85">
              We are preparing your freshly milled batch for dispatch and will notify you once
              packed.
            </p>
          </div>
        )}

        <ul className="divide-forest/15 mt-6 divide-y">
          {order.items.map((item) => (
            <li
              key={item.variantId}
              className="flex items-baseline justify-between gap-4 py-3 text-sm"
            >
              <div>
                <p className="font-serif text-lg font-medium">{item.productName}</p>
                <p className="text-sage text-xs">
                  {item.sizeLabel} × {item.qty}
                </p>
              </div>
              <p className="font-medium tabular-nums">{formatPaiseToInr(item.lineTotalPaise)}</p>
            </li>
          ))}
        </ul>

        <dl className="border-forest/15 mt-4 space-y-2 border-t pt-4 text-xs">
          <div className="flex justify-between">
            <dt className="text-sage tracking-[0.16em] uppercase">Items subtotal</dt>
            <dd className="tabular-nums">{formatPaiseToInr(order.itemsSubtotalPaise)}</dd>
          </div>
          {order.discountPaise > 0 ? (
            <div className="text-success flex justify-between">
              <dt className="tracking-[0.16em] uppercase">Discount</dt>
              <dd className="tabular-nums">− {formatPaiseToInr(order.discountPaise)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-sage tracking-[0.16em] uppercase">Shipping</dt>
            <dd className="tabular-nums">
              {order.shippingPaise === 0 ? '₹0' : formatPaiseToInr(order.shippingPaise)}
            </dd>
          </div>
          {order.codFeePaise > 0 ? (
            <div className="flex justify-between">
              <dt className="text-sage tracking-[0.16em] uppercase">COD fee</dt>
              <dd className="tabular-nums">{formatPaiseToInr(order.codFeePaise)}</dd>
            </div>
          ) : null}
          {order.tax.showTaxBreakdown ? (
            <div className="flex justify-between">
              <dt className="text-sage tracking-[0.16em] uppercase">
                {order.tax.includedInPrice ? 'Included GST' : 'GST'}
              </dt>
              <dd className="tabular-nums">{formatPaiseToInr(order.tax.taxPaise)}</dd>
            </div>
          ) : null}
          <div className="border-forest/15 flex items-baseline justify-between border-t pt-3 text-sm">
            <dt className="text-xs font-semibold tracking-[0.2em] uppercase">Total</dt>
            <dd className="font-serif text-3xl font-medium tabular-nums">
              {formatPaiseToInr(order.totalPaise)}
            </dd>
          </div>
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/shop"
            className="bg-forest text-ivory hover:bg-ink inline-flex min-h-12 items-center px-8 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
          >
            Continue shopping
          </Link>
        </div>
      </div>
    </section>
  )
}
