'use client'

import { useEffect, useId, useState } from 'react'
import { formatPaiseToInr, type PublicProductDto } from '@pressedoils/shared'
import { AnimatePresence, motion } from 'motion/react'
import { Check } from 'lucide-react'
import { useCart } from '@/lib/cart'

interface ProductPurchaseProps {
  product: PublicProductDto
  initialVariantId?: string
  showMaxNote?: boolean
}

export function ProductPurchase({
  product,
  initialVariantId,
  showMaxNote = false,
}: ProductPurchaseProps) {
  const defaultVariant =
    product.variants.find((v) => v.id === initialVariantId) ??
    product.variants.find((v) => v.inStock) ??
    product.variants[0]

  const [selectedVariantId, setSelectedVariantId] = useState<string>(defaultVariant?.id ?? '')
  const [added, setAdded] = useState(false)
  const { add, getVariantAvailability, getVariantQty, maxOrderQtyPerVariant } = useCart()
  const groupId = useId()

  const selectedVariant =
    product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0]

  useEffect(() => {
    if (!added) return
    const t = window.setTimeout(() => setAdded(false), 1800)
    return () => window.clearTimeout(t)
  }, [added])

  if (!selectedVariant) {
    return <p className="text-sage text-sm">No bottle sizes are currently listed for this oil.</p>
  }

  const availability = getVariantAvailability(selectedVariant)
  const inCartQty = getVariantQty(selectedVariant.id)
  const atClientCap = inCartQty >= maxOrderQtyPerVariant
  const canAdd = availability.inStock && !atClientCap

  return (
    <div>
      <fieldset>
        <legend className="sr-only">Choose a bottle size</legend>
        <div className="flex flex-wrap gap-2">
          {product.variants.map((variant) => {
            const vAvail = getVariantAvailability(variant)
            return (
              <label key={variant.id} className="cursor-pointer">
                <input
                  type="radio"
                  name={`${groupId}-size`}
                  value={variant.id}
                  checked={selectedVariant.id === variant.id}
                  onChange={() => setSelectedVariantId(variant.id)}
                  className="peer sr-only"
                />
                <span className="border-forest/30 text-forest peer-checked:border-forest peer-checked:bg-forest peer-checked:text-ivory peer-focus-visible:outline-gold hover:border-forest flex min-h-11 min-w-[4.5rem] items-center justify-center border px-4 text-sm transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                  <span>{variant.sizeLabel}</span>
                  {!vAvail.inStock ? (
                    <span className="ml-1.5 text-[10px] opacity-70">(Out)</span>
                  ) : null}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-6 flex items-baseline gap-3">
        <p className="text-forest font-serif text-3xl font-medium tabular-nums">
          {formatPaiseToInr(selectedVariant.pricePaise)}
        </p>
        {selectedVariant.mrpPaise !== null &&
        selectedVariant.mrpPaise > selectedVariant.pricePaise ? (
          <p className="text-sage text-sm tabular-nums line-through">
            {formatPaiseToInr(selectedVariant.mrpPaise)}
          </p>
        ) : null}
      </div>

      {!availability.inStock ? (
        <p className="text-error mt-2 text-xs font-medium tracking-[0.14em] uppercase">Sold out</p>
      ) : availability.lowStock && availability.availableStock !== undefined ? (
        <p className="text-bronze mt-2 text-xs font-medium tracking-[0.14em] uppercase">
          Only {availability.availableStock} left
        </p>
      ) : (
        <p className="text-success mt-2 text-xs font-medium tracking-[0.14em] uppercase">
          In stock
        </p>
      )}

      <motion.button
        type="button"
        disabled={!canAdd}
        whileTap={canAdd ? { scale: 0.98 } : undefined}
        onClick={() => {
          if (!canAdd) return
          add(selectedVariant.id, 1)
          setAdded(true)
        }}
        className="bg-forest text-ivory hover:bg-ink relative mt-4 flex min-h-12 w-full items-center justify-center overflow-hidden px-6 text-[12px] font-semibold tracking-[0.2em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-45"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={!availability.inStock ? 'sold-out' : atClientCap ? 'cap' : added ? 'added' : 'add'}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2"
          >
            {!availability.inStock ? (
              'Sold out'
            ) : atClientCap ? (
              `Max ${maxOrderQtyPerVariant} in bag`
            ) : added ? (
              <>
                <Check className="text-gold size-4" aria-hidden /> Added to bag
              </>
            ) : (
              'Add to bag'
            )}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      {showMaxNote ? (
        <p className="text-sage mt-2.5 text-xs">
          Limit {maxOrderQtyPerVariant} per bottle size per order.
        </p>
      ) : null}
    </div>
  )
}
