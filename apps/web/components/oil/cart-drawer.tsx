'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { formatPaiseToInr } from '@pressedoils/shared'
import { AnimatePresence, motion } from 'motion/react'
import { Minus, Plus, ShoppingBag, X } from 'lucide-react'
import { useCart } from '@/lib/cart'
import { lockScroll } from '@/lib/lenis'

export function CartDrawer() {
  const {
    lines,
    count,
    subtotalPaise,
    isOpen,
    setOpen,
    setQty,
    remove,
    maxOrderQtyPerVariant,
    freeShippingThresholdPaise,
    hasUnresolvedItems,
  } = useCart()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement as HTMLElement | null
    lockScroll(true)
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => {
      lockScroll(false)
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [isOpen, setOpen])

  const remainingForFreeShipping =
    freeShippingThresholdPaise > 0 ? Math.max(0, freeShippingThresholdPaise - subtotalPaise) : 0

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[90]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close bag"
            onClick={() => setOpen(false)}
            className="bg-forest/70 absolute inset-0 cursor-default backdrop-blur-sm"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Shopping bag"
            data-lenis-prevent
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="bg-ivory text-forest absolute inset-y-0 right-0 flex w-full max-w-md flex-col shadow-2xl"
          >
            <header className="border-forest/15 flex items-center justify-between border-b px-6 py-5">
              <h2 className="font-serif text-3xl font-medium">
                Bag <span className="tabular-nums">({count})</span>
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close bag"
                className="hover:bg-gold/30 flex size-11 items-center justify-center"
              >
                <X className="size-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6">
              {lines.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
                  <ShoppingBag className="text-gold size-10" strokeWidth={1.2} aria-hidden />
                  <p className="font-serif text-3xl font-medium italic">
                    {hasUnresolvedItems ? 'Syncing your bag…' : 'Your bag is empty.'}
                  </p>
                  <Link
                    href="/shop"
                    onClick={() => setOpen(false)}
                    className="link-underline pb-1 text-[12px] font-semibold tracking-[0.2em] uppercase"
                  >
                    Explore the oils
                  </Link>
                </div>
              ) : (
                <ul className="divide-forest/15 divide-y">
                  {lines.map((line) => {
                    const atLimit = line.qty >= maxOrderQtyPerVariant
                    const outOfStock = !line.availability.inStock
                    return (
                      <li key={line.variantId} className="flex gap-4 py-6">
                        <Link
                          href={`/products/${line.productSlug}`}
                          onClick={() => setOpen(false)}
                          className="bg-sand relative h-28 w-20 shrink-0 overflow-hidden"
                        >
                          {line.imageUrl ? (
                            <Image
                              src={line.imageUrl}
                              alt={line.imageAlt}
                              fill
                              sizes="80px"
                              className="object-cover"
                            />
                          ) : null}
                        </Link>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <Link
                            href={`/products/${line.productSlug}`}
                            onClick={() => setOpen(false)}
                            className="hover:text-bronze font-serif text-2xl leading-tight font-medium transition-colors"
                          >
                            {line.productName}
                          </Link>
                          <p className="text-sage mt-1 text-sm">{line.sizeLabel}</p>
                          <p className="mt-1 text-sm font-medium tabular-nums">
                            {formatPaiseToInr(line.lineTotalPaise)}
                            <span className="text-sage ml-2 text-xs font-normal">
                              ({formatPaiseToInr(line.unitPricePaise)} each)
                            </span>
                          </p>
                          {outOfStock ? (
                            <p className="text-error mt-1 text-xs font-medium">
                              Currently sold out
                            </p>
                          ) : line.availability.lowStock &&
                            line.availability.availableStock !== undefined ? (
                            <p className="text-bronze mt-1 text-xs font-medium">
                              Only {line.availability.availableStock} left
                            </p>
                          ) : null}

                          <div className="mt-auto flex items-center justify-between pt-3">
                            <div className="border-forest/30 flex items-center border">
                              <button
                                type="button"
                                aria-label={`Decrease ${line.productName} ${line.sizeLabel}`}
                                onClick={() => setQty(line.variantId, line.qty - 1)}
                                className="hover:bg-gold/30 flex size-11 items-center justify-center"
                              >
                                <Minus className="size-4" />
                              </button>
                              <span
                                className="w-8 text-center text-sm tabular-nums"
                                aria-live="polite"
                              >
                                {line.qty}
                              </span>
                              <button
                                type="button"
                                aria-label={`Increase ${line.productName} ${line.sizeLabel}`}
                                disabled={atLimit || outOfStock}
                                onClick={() => setQty(line.variantId, line.qty + 1)}
                                className="hover:bg-gold/30 flex size-11 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Plus className="size-4" />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => remove(line.variantId)}
                              className="text-sage hover:text-forest min-h-11 px-2 text-xs tracking-[0.18em] uppercase underline-offset-4 hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {lines.length > 0 && (
              <footer className="border-forest/15 border-t px-6 py-6">
                {freeShippingThresholdPaise > 0 ? (
                  <p className="text-sage mb-3 text-xs">
                    {remainingForFreeShipping === 0
                      ? 'Qualifies for complimentary delivery.'
                      : `Add ${formatPaiseToInr(remainingForFreeShipping)} more for complimentary delivery.`}
                  </p>
                ) : null}
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold tracking-[0.24em] uppercase">
                    Subtotal
                  </span>
                  <span className="font-serif text-3xl font-medium tabular-nums">
                    {formatPaiseToInr(subtotalPaise)}
                  </span>
                </div>
                <button
                  type="button"
                  disabled
                  className="bg-forest/40 text-ivory mt-5 min-h-12 w-full cursor-not-allowed text-[12px] font-semibold tracking-[0.2em] uppercase"
                >
                  Checkout not yet active
                </button>
                <p className="text-sage mt-3 text-xs">
                  Bag items are priced live from the catalog. Checkout opens in Phase 5.
                </p>
              </footer>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
