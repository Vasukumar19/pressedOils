'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Eye, X } from 'lucide-react'
import { useCart } from '@/lib/cart'
import { lockScroll } from '@/lib/lenis'
import { PRODUCTS, SIZES, formatPrice, type Product, type Size } from '@/lib/products'
import { cn } from '@/lib/utils'
import { Eyebrow, MaskLines, MediaFrame } from './primitives'

function ProductPurchase({ product }: { product: Product }) {
  const [size, setSize] = useState<Size>('500 ml')
  const [added, setAdded] = useState(false)
  const { add } = useCart()
  const groupId = useId()
  const price = product.prices[size]
  const anyPriced = Object.values(product.prices).some((p) => p !== null)

  useEffect(() => {
    if (!added) return
    const t = window.setTimeout(() => setAdded(false), 1800)
    return () => window.clearTimeout(t)
  }, [added])

  return (
    <div>
      <fieldset>
        <legend className="sr-only">Choose a size</legend>
        <div className="flex flex-wrap gap-2">
          {SIZES.map((s) => (
            <label key={s} className="cursor-pointer">
              <input
                type="radio"
                name={`${groupId}-size`}
                value={s}
                checked={size === s}
                onChange={() => setSize(s)}
                className="peer sr-only"
              />
              <span className="flex min-h-11 min-w-[4.5rem] items-center justify-center border border-forest/30 px-4 text-sm text-forest transition-colors peer-checked:border-forest peer-checked:bg-forest peer-checked:text-ivory peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold hover:border-forest">
                {s}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="mt-6 font-serif font-medium text-3xl text-forest">
        {anyPriced ? (
          formatPrice(price)
        ) : (
          <>
            From <span className="ph">[PRICE]</span>
          </>
        )}
      </p>

      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => {
          add(product.id, size)
          setAdded(true)
        }}
        className="relative mt-5 flex min-h-12 w-full items-center justify-center overflow-hidden bg-forest px-6 text-[12px] font-semibold uppercase tracking-[0.2em] text-ivory transition-colors hover:bg-ink"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={added ? 'added' : 'add'}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2"
          >
            {added ? (
              <>
                <Check className="size-4 text-gold" aria-hidden /> Added to bag
              </>
            ) : (
              'Add to cart · preview'
            )}
          </motion.span>
        </AnimatePresence>
      </motion.button>
      <p className="mt-3 text-xs text-sage">Price &amp; availability to be confirmed</p>
    </div>
  )
}

function ProductCard({
  product,
  onPreview,
  className,
}: {
  product: Product
  onPreview: () => void
  className?: string
}) {
  return (
    <article className={cn('group', className)}>
      <div className="relative">
        <MediaFrame
          src={product.image}
          alt={product.imageAlt}
          caption={product.placeholder}
          tag="PRODUCT PHOTOGRAPHY / MEDIA PLACEHOLDER"
          zoomOnHover
          className="aspect-[4/5] w-full"
          sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"
          captionClassName="max-w-[calc(100%-1.5rem)]"
        />
        <span className="absolute left-4 top-4 z-10 font-mono text-xs tracking-widest text-ivory">
          {product.index}
        </span>
        <button
          type="button"
          onClick={onPreview}
          className="absolute right-3 top-3 z-10 flex min-h-11 items-center gap-2 bg-ivory/90 px-3.5 text-xs font-semibold uppercase tracking-[0.18em] text-forest backdrop-blur transition-colors hover:bg-gold"
          aria-label={`Quick view ${product.name}`}
        >
          <Eye className="size-4" aria-hidden />
          <span className="hidden sm:inline">Quick view</span>
        </button>
      </div>

      <div className="mt-6">
        <h3 className="font-serif text-4xl leading-none text-forest">{product.name}</h3>
        <p lang="ta" className="mt-2 font-tamil text-base text-sage">
          {product.native}
        </p>
        <p className="mt-4 text-[15px] text-ink/85">{product.use}</p>
        <p className="mt-1 text-[13px] text-sage">
          Grown in <span className="ph">{product.region}</span>
        </p>
        <div className="mt-6 border-t border-forest/15 pt-6">
          <ProductPurchase product={product} />
        </div>
      </div>
    </article>
  )
}

function ProductPreview({ product, onClose }: { product: Product; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    lockScroll(true)
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      lockScroll(false)
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <button
        type="button"
        aria-label="Close quick view"
        onClick={onClose}
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-forest/80 backdrop-blur-sm"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`${product.name} quick view`}
        data-lenis-prevent
        initial={{ y: 40, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative grid max-h-[92svh] w-full max-w-4xl overflow-y-auto bg-ivory md:grid-cols-2"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 z-20 flex size-11 items-center justify-center bg-ivory/90 text-forest hover:bg-gold"
        >
          <X className="size-5" />
        </button>
        <MediaFrame
          src={product.image}
          alt={product.imageAlt}
          caption={product.placeholder}
          tag="MEDIA PLACEHOLDER"
          className="aspect-[4/5] w-full md:aspect-auto md:min-h-[560px]"
          sizes="(min-width: 768px) 440px, 100vw"
        />
        <div className="p-7 md:p-10">
          <p className="font-mono text-xs tracking-widest text-sage">PRODUCT {product.index}</p>
          <h3 className="mt-3 font-serif text-5xl leading-none text-forest">{product.name}</h3>
          <p lang="ta" className="mt-2 font-tamil text-base text-sage">
            {product.native}
          </p>
          <p className="mt-6 text-[15px] leading-relaxed text-ink/85">{product.use}</p>
          <p className="mt-1 text-[13px] text-sage">
            Grown in <span className="ph">{product.region}</span>
          </p>
          <div className="mt-8 border-t border-forest/15 pt-8">
            <ProductPurchase product={product} />
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

export function ProductSection() {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const preview = PRODUCTS.find((p) => p.id === previewId)

  return (
    <section id="shop" className="bg-ivory py-24 md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <Eyebrow>07 / The pantry</Eyebrow>
        <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-end">
          <h2 className="text-[clamp(2.75rem,6vw,5.5rem)] leading-[1] text-forest lg:col-span-8">
            <MaskLines
              lines={['Three seeds.', <em key="w">A world of flavour.</em>]}
            />
          </h2>
          <p data-reveal className="max-w-sm text-lg leading-relaxed text-sage lg:col-span-4 lg:pb-3">
            Unhurried oils for the meals you make every day.
          </p>
        </div>

        <div data-stagger="0.15" className="mt-16 grid gap-14 md:mt-24 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {PRODUCTS.map((product, i) => (
            <ProductCard
              key={product.id}
              product={product}
              onPreview={() => setPreviewId(product.id)}
              className={i === 1 ? 'lg:mt-16' : undefined}
            />
          ))}
        </div>

        <div data-reveal className="mt-24 grid gap-6 border-y border-forest/20 py-10 md:grid-cols-12">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-forest md:col-span-3">
            Why the price?
          </p>
          <p className="max-w-2xl font-serif font-medium text-2xl leading-snug text-forest md:col-span-9 md:text-3xl">
            More whole seeds, less oil per batch, time to settle and independent testing. Final
            prices will be shown before ordering.
          </p>
        </div>
      </div>

      <AnimatePresence>
        {preview && <ProductPreview key={preview.id} product={preview} onClose={() => setPreviewId(null)} />}
      </AnimatePresence>
    </section>
  )
}
