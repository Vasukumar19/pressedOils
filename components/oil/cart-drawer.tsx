'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'motion/react'
import { Minus, Plus, ShoppingBag, X } from 'lucide-react'
import { useCart } from '@/lib/cart'
import { lockScroll } from '@/lib/lenis'
import { formatPrice, getProduct } from '@/lib/products'

export function CartDrawer() {
  const { lines, count, subtotal, hasUnpriced, isOpen, setOpen, setQty, remove } = useCart()
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
            className="absolute inset-0 cursor-default bg-forest/70 backdrop-blur-sm"
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
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-ivory text-forest shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-forest/15 px-6 py-5">
              <h2 className="font-serif font-medium text-3xl">
                Bag <span className="tabular-nums">({count})</span>
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close bag"
                className="flex size-11 items-center justify-center hover:bg-gold/30"
              >
                <X className="size-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6">
              {lines.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
                  <ShoppingBag className="size-10 text-gold" strokeWidth={1.2} aria-hidden />
                  <p className="font-serif font-medium text-3xl italic">Your bag is empty.</p>
                  <a
                    href="#shop"
                    onClick={() => setOpen(false)}
                    className="link-underline pb-1 text-[12px] font-semibold uppercase tracking-[0.2em]"
                  >
                    Explore the oils
                  </a>
                </div>
              ) : (
                <ul className="divide-y divide-forest/15">
                  {lines.map((line) => {
                    const product = getProduct(line.productId)
                    if (!product) return null
                    const unit = product.prices[line.size]
                    return (
                      <li key={`${line.productId}-${line.size}`} className="flex gap-4 py-6">
                        <div className="relative h-28 w-20 shrink-0 overflow-hidden bg-forest">
                          <Image src={product.image} alt={product.imageAlt} fill sizes="80px" className="object-cover" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <p className="font-serif font-medium text-2xl leading-tight">{product.name}</p>
                          <p className="mt-1 text-sm text-sage">{line.size}</p>
                          <p className="mt-1 text-sm">
                            {unit === null ? <span className="ph">[PRICE]</span> : formatPrice(unit * line.qty)}
                          </p>
                          <div className="mt-auto flex items-center justify-between pt-3">
                            <div className="flex items-center border border-forest/30">
                              <button
                                type="button"
                                aria-label={`Decrease ${product.name} ${line.size}`}
                                onClick={() => setQty(line.productId, line.size, line.qty - 1)}
                                className="flex size-11 items-center justify-center hover:bg-gold/30"
                              >
                                <Minus className="size-4" />
                              </button>
                              <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
                                {line.qty}
                              </span>
                              <button
                                type="button"
                                aria-label={`Increase ${product.name} ${line.size}`}
                                onClick={() => setQty(line.productId, line.size, line.qty + 1)}
                                className="flex size-11 items-center justify-center hover:bg-gold/30"
                              >
                                <Plus className="size-4" />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => remove(line.productId, line.size)}
                              className="min-h-11 px-2 text-xs uppercase tracking-[0.18em] text-sage underline-offset-4 hover:text-forest hover:underline"
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
              <footer className="border-t border-forest/15 px-6 py-6">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.24em]">Subtotal</span>
                  <span className="font-serif font-medium text-3xl">
                    {hasUnpriced && subtotal === 0 ? (
                      <span className="ph">[PRICE]</span>
                    ) : (
                      formatPrice(subtotal)
                    )}
                  </span>
                </div>
                {hasUnpriced && (
                  <p className="mt-2 text-xs text-sage">Price &amp; availability to be confirmed.</p>
                )}
                <button
                  type="button"
                  disabled
                  className="mt-5 min-h-12 w-full cursor-not-allowed bg-forest/40 text-[12px] font-semibold uppercase tracking-[0.2em] text-ivory"
                >
                  Checkout not connected
                </button>
                <p className="mt-3 text-xs text-sage">Preview only. No order is placed.</p>
              </footer>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
