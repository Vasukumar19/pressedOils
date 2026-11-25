'use client'

import { formatPaiseToInr, type CartValidateResponseDto } from '@pressedoils/shared'

interface PriceBreakdownProps {
  validation: CartValidateResponseDto
  className?: string
}

export function PriceBreakdown({ validation, className }: PriceBreakdownProps) {
  const { summary, freeShipping, tax, pincode } = validation

  const progressRatio =
    freeShipping && freeShipping.thresholdPaise > 0
      ? Math.min(1, summary.netItemsTotalPaise / freeShipping.thresholdPaise)
      : 0

  return (
    <div className={className}>
      {freeShipping ? (
        <div className="border-gold/35 bg-champagne/60 mb-4 border p-3">
          <p className="text-forest text-xs font-medium">
            {freeShipping.qualified
              ? 'You qualify for free delivery.'
              : `Add ${formatPaiseToInr(freeShipping.remainingPaise)} more for free shipping.`}
          </p>
          <div aria-hidden className="bg-sand mt-2 h-1.5 w-full overflow-hidden">
            <div
              className="bg-gold h-full transition-[width] duration-300"
              style={{ width: `${Math.round(progressRatio * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      <dl className="space-y-2 text-xs">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sage tracking-[0.16em] uppercase">Items subtotal</dt>
          <dd className="text-forest font-medium tabular-nums">
            {formatPaiseToInr(summary.itemsSubtotalPaise)}
          </dd>
        </div>

        {summary.discountPaise > 0 ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-success tracking-[0.16em] uppercase">
              Coupon {validation.coupon?.code ? `(${validation.coupon.code})` : ''}
            </dt>
            <dd className="text-success font-medium tabular-nums">
              − {formatPaiseToInr(summary.discountPaise)}
            </dd>
          </div>
        ) : null}

        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sage tracking-[0.16em] uppercase">
            {summary.shippingStatus === 'PICKUP_FREE' ? 'Store pickup' : 'Shipping'}
          </dt>
          <dd className="text-right tabular-nums">
            {summary.shippingStatus === 'PICKUP_FREE' ? (
              <span className="text-success font-medium">₹0</span>
            ) : summary.shippingStatus === 'ENTER_PINCODE' ? (
              <span className="text-sage">Calculated from pincode</span>
            ) : summary.shippingStatus === 'UNSERVICEABLE' ? (
              <span className="text-error font-medium">
                Not serviceable{pincode ? ` (${pincode.pincode})` : ''}
              </span>
            ) : summary.shippingPaise === 0 ? (
              <span className="text-success font-medium">Free</span>
            ) : summary.shippingPaise !== null ? (
              <span className="text-forest font-medium">
                {formatPaiseToInr(summary.shippingPaise)}
              </span>
            ) : null}
          </dd>
        </div>

        {tax.showTaxBreakdown ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sage tracking-[0.16em] uppercase">
              {tax.includedInPrice ? 'Included GST' : 'GST'} (
              {(tax.rateBps / 100).toFixed(tax.rateBps % 100 === 0 ? 0 : 1)}%)
            </dt>
            <dd className="text-forest tabular-nums">{formatPaiseToInr(tax.taxPaise)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="border-forest/15 mt-4 flex items-baseline justify-between border-t pt-3">
        <span className="text-xs font-semibold tracking-[0.24em] uppercase">
          {summary.totalLabel}
        </span>
        <span className="font-serif text-3xl font-medium tabular-nums">
          {formatPaiseToInr(summary.totalPaise)}
        </span>
      </div>
    </div>
  )
}
