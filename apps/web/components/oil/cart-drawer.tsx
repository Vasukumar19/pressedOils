'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { FULFILMENT_METHOD, formatPaiseToInr } from '@pressedoils/shared'
import { AnimatePresence, motion } from 'motion/react'
import { MapPin, Minus, Plus, ShoppingBag, Store, Tag, X } from 'lucide-react'
import { useCart } from '@/lib/cart'
import { lockScroll } from '@/lib/lenis'
import { PriceBreakdown } from './price-breakdown'

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
}

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
    storePickupEnabled,
    pickupLocations,
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
    validateError,
    revalidateCartNow,
    hasUnresolvedItems,
    checkoutEnabled,
  } = useCart()

  const drawerRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [couponInput, setCouponInput] = useState(couponCode)
  const [pincodeInput, setPincodeInput] = useState(pincode)
  const [pincodeFormatError, setPincodeFormatError] = useState<string | null>(null)

  useEffect(() => {
    setCouponInput(couponCode)
  }, [couponCode])

  useEffect(() => {
    setPincodeInput(pincode)
  }, [pincode])

  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement as HTMLElement | null
    lockScroll(true)
    closeRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = getFocusableElements(drawerRef.current)
        if (focusable.length === 0) return
        const first = focusable[0]!
        const last = focusable[focusable.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      lockScroll(false)
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [isOpen, setOpen])

  function onApplyCoupon(e: FormEvent) {
    e.preventDefault()
    const normalized = couponInput.trim().toUpperCase()
    setCouponCode(normalized)
    void revalidateCartNow({ couponCode: normalized })
  }

  function onClearCoupon() {
    setCouponInput('')
    setCouponCode('')
    void revalidateCartNow({ couponCode: '' })
  }

  function onCheckPincode(e: FormEvent) {
    e.preventDefault()
    const cleaned = pincodeInput.trim()
    if (!/^[1-9][0-9]{5}$/.test(cleaned)) {
      setPincodeFormatError('Enter a valid 6-digit Indian pincode.')
      return
    }
    setPincodeFormatError(null)
    setPincode(cleaned)
    void revalidateCartNow({ pincode: cleaned })
  }

  const validatedById = new Map((validation?.items ?? []).map((item) => [item.variantId, item]))
  const hasBlockingItemIssue = (validation?.items ?? []).some(
    (item) =>
      item.status === 'OUT_OF_STOCK' ||
      item.status === 'UNAVAILABLE' ||
      item.status === 'QUANTITY_UNAVAILABLE',
  )
  const canProceedToCheckout = checkoutEnabled && !hasBlockingItemIssue && !isValidating

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
            ref={drawerRef}
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
            <header className="border-forest/15 flex items-center justify-between border-b px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex items-baseline gap-3">
                <h2 className="font-serif text-3xl font-medium">
                  Bag <span className="tabular-nums">({count})</span>
                </h2>
                {isValidating ? (
                  <span className="text-sage text-[11px] tracking-[0.16em] uppercase">
                    Updating…
                  </span>
                ) : null}
              </div>
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

            <div className="flex-1 overflow-y-auto px-5 sm:px-6">
              {lines.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
                  <ShoppingBag className="text-gold size-10" strokeWidth={1.2} aria-hidden />
                  <p className="font-serif text-3xl font-medium italic">
                    {hasUnresolvedItems ? 'Syncing your bag…' : 'Your bag is empty.'}
                  </p>
                  <Link
                    href="/shop"
                    onClick={() => setOpen(false)}
                    className="link-underline inline-flex min-h-11 items-center pb-1 text-[12px] font-semibold tracking-[0.2em] uppercase"
                  >
                    Explore the oils
                  </Link>
                </div>
              ) : (
                <>
                  {validateError ? (
                    <div
                      role="alert"
                      className="border-error/30 bg-error-bg text-error mt-4 border p-3 text-xs"
                    >
                      {validateError}
                    </div>
                  ) : null}

                  <ul className="divide-forest/15 divide-y">
                    {lines.map((line) => {
                      const serverLine = validatedById.get(line.variantId)
                      const atLimit = line.qty >= maxOrderQtyPerVariant
                      const outOfStock = serverLine
                        ? !serverLine.inStock
                        : !line.availability.inStock
                      const statusMessage = serverLine?.statusMessage ?? null
                      const showWarningBanner =
                        serverLine &&
                        (serverLine.status === 'QUANTITY_UNAVAILABLE' ||
                          serverLine.status === 'OUT_OF_STOCK' ||
                          serverLine.status === 'UNAVAILABLE' ||
                          serverLine.status === 'ADJUSTED_QTY')

                      return (
                        <li key={line.variantId} className="flex gap-3 py-5 sm:gap-4 sm:py-6">
                          <Link
                            href={`/products/${line.productSlug}`}
                            onClick={() => setOpen(false)}
                            className="bg-sand relative h-24 w-18 shrink-0 overflow-hidden sm:h-28 sm:w-20"
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
                              className="hover:text-bronze font-serif text-xl leading-tight font-medium transition-colors sm:text-2xl"
                            >
                              {line.productName}
                            </Link>
                            <p className="text-sage mt-1 text-xs sm:text-sm">{line.sizeLabel}</p>
                            <p className="mt-1 text-sm font-medium tabular-nums">
                              {formatPaiseToInr(line.lineTotalPaise)}
                              <span className="text-sage ml-2 text-xs font-normal">
                                ({formatPaiseToInr(line.unitPricePaise)} each)
                              </span>
                            </p>

                            {showWarningBanner && statusMessage ? (
                              <p
                                className={`mt-1.5 text-xs font-medium ${
                                  serverLine.status === 'ADJUSTED_QTY'
                                    ? 'text-bronze'
                                    : 'text-error'
                                }`}
                              >
                                {statusMessage}
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
                                  disabled={
                                    atLimit ||
                                    outOfStock ||
                                    serverLine?.status === 'QUANTITY_UNAVAILABLE'
                                  }
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

                  {/* Fulfilment & Delivery/Pickup options */}
                  <section
                    aria-label="Delivery and coupon options"
                    className="border-forest/15 space-y-5 border-t py-5"
                  >
                    {storePickupEnabled && pickupLocations.length > 0 ? (
                      <div>
                        <p className="text-sage mb-2 text-[11px] font-semibold tracking-[0.18em] uppercase">
                          How would you like to receive your order?
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setFulfilmentMethod(FULFILMENT_METHOD.DELIVERY)}
                            className={`flex min-h-11 items-center justify-center gap-2 border px-3 text-xs font-medium tracking-[0.12em] uppercase transition-colors ${
                              fulfilmentMethod === FULFILMENT_METHOD.DELIVERY
                                ? 'border-forest bg-forest text-ivory'
                                : 'border-forest/30 text-forest hover:border-forest'
                            }`}
                          >
                            <MapPin className="size-3.5" aria-hidden />
                            Delivery
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const nextId = pickupLocationId ?? pickupLocations[0]?.id
                              setFulfilmentMethod(FULFILMENT_METHOD.STORE_PICKUP)
                              if (nextId) setPickupLocationId(nextId)
                            }}
                            className={`flex min-h-11 items-center justify-center gap-2 border px-3 text-xs font-medium tracking-[0.12em] uppercase transition-colors ${
                              fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP
                                ? 'border-forest bg-forest text-ivory'
                                : 'border-forest/30 text-forest hover:border-forest'
                            }`}
                          >
                            <Store className="size-3.5" aria-hidden />
                            Store pickup
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {fulfilmentMethod === FULFILMENT_METHOD.DELIVERY ? (
                      <form onSubmit={onCheckPincode} noValidate className="space-y-2">
                        <label
                          htmlFor="cart-pincode"
                          className="text-sage block text-[11px] font-semibold tracking-[0.18em] uppercase"
                        >
                          Delivery pincode
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="cart-pincode"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={pincodeInput}
                            onChange={(e) => setPincodeInput(e.target.value)}
                            placeholder="e.g. 600001"
                            className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 min-w-0 flex-1 border px-3 font-mono text-sm"
                          />
                          <button
                            type="submit"
                            className="border-forest/30 text-forest hover:border-forest min-h-11 shrink-0 border px-4 text-xs font-semibold tracking-[0.16em] uppercase transition-colors"
                          >
                            Check
                          </button>
                        </div>
                        {pincodeFormatError ? (
                          <p role="alert" className="text-error text-xs">
                            {pincodeFormatError}
                          </p>
                        ) : validation?.pincode ? (
                          validation.pincode.serviceable ? (
                            <p className="text-success text-xs">
                              {validation.pincode.city}, {validation.pincode.state} · Estimated{' '}
                              {validation.pincode.deliveryDays}{' '}
                              {validation.pincode.deliveryDays === 1 ? 'day' : 'days'}
                              {validation.pincode.codAllowed
                                ? ' · COD available'
                                : ' · Prepaid only'}
                            </p>
                          ) : (
                            <p className="text-error text-xs">
                              Sorry, delivery is not yet serviceable for{' '}
                              {validation.pincode.pincode}.
                            </p>
                          )
                        ) : null}
                      </form>
                    ) : (
                      <div className="border-gold/35 bg-champagne/40 space-y-2 border p-3.5 text-xs">
                        {pickupLocations.length > 1 ? (
                          <div className="space-y-1.5">
                            <label
                              htmlFor="pickup-location-select"
                              className="text-sage block text-[11px] font-semibold tracking-[0.16em] uppercase"
                            >
                              Pickup store
                            </label>
                            <select
                              id="pickup-location-select"
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

                        {validation?.pickup ? (
                          <>
                            <p className="text-forest font-semibold">
                              {validation.pickup.location.name}
                            </p>
                            <p className="text-ink/80">{validation.pickup.location.address}</p>
                            <p className="text-sage">Hours: {validation.pickup.location.hours}</p>
                            <p className="text-success font-medium">
                              Estimated ready: {validation.pickup.estimatedReadyDisplay}
                            </p>
                          </>
                        ) : pickupLocations[0] ? (
                          <>
                            <p className="text-forest font-semibold">{pickupLocations[0].name}</p>
                            <p className="text-ink/80">{pickupLocations[0].address}</p>
                            <p className="text-sage">Hours: {pickupLocations[0].hours}</p>
                          </>
                        ) : null}
                      </div>
                    )}

                    {/* Coupon input */}
                    <form onSubmit={onApplyCoupon} noValidate className="space-y-2">
                      <label
                        htmlFor="cart-coupon"
                        className="text-sage flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.18em] uppercase"
                      >
                        <Tag className="size-3.5" aria-hidden />
                        Coupon code
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="cart-coupon"
                          type="text"
                          value={couponInput}
                          onChange={(e) => setCouponInput(e.target.value)}
                          placeholder="Enter code"
                          autoComplete="off"
                          className="border-forest/30 bg-ivory text-forest placeholder:text-sage/70 focus-visible:border-forest min-h-11 min-w-0 flex-1 border px-3 font-mono text-sm uppercase"
                        />
                        {couponCode ? (
                          <button
                            type="button"
                            onClick={onClearCoupon}
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
                          className={`text-xs ${
                            validation.coupon.applied ? 'text-success' : 'text-error'
                          }`}
                        >
                          {validation.coupon.message}
                        </p>
                      ) : null}
                    </form>
                  </section>
                </>
              )}
            </div>

            {lines.length > 0 && (
              <footer className="border-forest/15 border-t px-5 py-5 sm:px-6 sm:py-6">
                {validation ? (
                  <PriceBreakdown validation={validation} />
                ) : (
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-semibold tracking-[0.24em] uppercase">
                      Items total
                    </span>
                    <span className="font-serif text-3xl font-medium tabular-nums">
                      {formatPaiseToInr(subtotalPaise)}
                    </span>
                  </div>
                )}

                {!checkoutEnabled ? (
                  <>
                    <button
                      type="button"
                      disabled
                      className="bg-forest/40 text-ivory mt-5 min-h-12 w-full cursor-not-allowed text-[12px] font-semibold tracking-[0.2em] uppercase"
                    >
                      Checkout opening soon
                    </button>
                    <p className="text-sage mt-2.5 text-xs">
                      Store legal policies are pending owner approval before public checkout opens.
                    </p>
                  </>
                ) : !canProceedToCheckout ? (
                  <>
                    <button
                      type="button"
                      disabled
                      className="bg-forest/40 text-ivory mt-5 min-h-12 w-full cursor-not-allowed text-[12px] font-semibold tracking-[0.2em] uppercase"
                    >
                      {hasBlockingItemIssue ? 'Adjust bag items to continue' : 'Updating bag…'}
                    </button>
                    <p className="text-sage mt-2.5 text-xs">
                      Resolve unavailable quantities above before proceeding to checkout.
                    </p>
                  </>
                ) : (
                  <>
                    <Link
                      href="/checkout"
                      onClick={() => setOpen(false)}
                      className="bg-forest text-ivory hover:bg-ink mt-5 flex min-h-12 w-full items-center justify-center text-[12px] font-semibold tracking-[0.2em] uppercase transition-colors"
                    >
                      Proceed to checkout
                    </Link>
                    <p className="text-sage mt-2.5 text-xs">
                      Prices, delivery availability, and stock are verified live on checkout.
                    </p>
                  </>
                )}
              </footer>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
