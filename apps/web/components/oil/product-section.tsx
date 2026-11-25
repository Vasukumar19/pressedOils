'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { isPlaceholderUrl, type PublicProductDto } from '@pressedoils/shared'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Eye, X } from 'lucide-react'
import { lockScroll } from '@/lib/lenis'
import { cn } from '@/lib/utils'
import { Eyebrow, MaskLines, MediaFrame } from './primitives'
import { ProductPurchase } from './product-purchase'

function resolveProductPrimaryImage(product: PublicProductDto) {
  const image = product.images[0]
  return {
    src: image?.url ?? '/images/hero-light.png',
    alt: image?.alt ?? `${product.name} bottle`,
    isPlaceholder: image ? isPlaceholderUrl(image.url) : true,
  }
}

export function ProductCard({
  product,
  indexLabel,
  onPreview,
  className,
}: {
  product: PublicProductDto
  indexLabel: string
  onPreview: () => void
  className?: string
}) {
  const media = resolveProductPrimaryImage(product)

  return (
    <article className={cn('group flex flex-col', className)}>
      <div className="relative">
        <Link href={`/products/${product.slug}`} className="block">
          <MediaFrame
            src={media.src}
            alt={media.alt}
            caption={media.isPlaceholder ? '[SAMPLE PRODUCT PHOTO]' : undefined}
            tag={media.isPlaceholder ? 'MEDIA PLACEHOLDER' : undefined}
            zoomOnHover
            className="aspect-[4/5] w-full"
            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 82vw"
            captionClassName="max-w-[calc(100%-1.5rem)]"
          />
        </Link>
        <span className="text-ivory bg-forest/70 pointer-events-none absolute top-4 left-4 z-10 px-2 py-0.5 font-mono text-xs tracking-widest">
          {indexLabel}
        </span>
        <button
          type="button"
          onClick={onPreview}
          className="bg-ivory/90 text-forest hover:bg-gold absolute top-3 right-3 z-10 flex min-h-11 items-center gap-2 px-3.5 text-xs font-semibold tracking-[0.18em] uppercase backdrop-blur transition-colors"
          aria-label={`Quick view ${product.name}`}
        >
          <Eye className="size-4" aria-hidden />
          <span className="hidden sm:inline">Quick view</span>
        </button>
      </div>

      <div className="mt-6 flex flex-1 flex-col">
        <Link href={`/products/${product.slug}`} className="group/title inline-block">
          <h3 className="text-forest group-hover/title:text-bronze font-serif text-4xl leading-none transition-colors">
            {product.name}
          </h3>
        </Link>
        <p className="text-ink/85 mt-4 text-[15px]">{product.bestFor}</p>
        <p className="text-sage mt-1 text-[13px]">Grown in {product.originRegion}</p>
        <div className="border-forest/15 mt-6 border-t pt-6">
          <ProductPurchase product={product} />
        </div>
      </div>
    </article>
  )
}

export function ProductPreview({
  product,
  indexLabel,
  onClose,
}: {
  product: PublicProductDto
  indexLabel: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const media = resolveProductPrimaryImage(product)

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
        className="bg-forest/80 absolute inset-0 cursor-default backdrop-blur-sm"
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
        className="bg-ivory relative grid max-h-[92svh] w-full max-w-4xl overflow-y-auto md:grid-cols-2"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="bg-ivory/90 text-forest hover:bg-gold absolute top-2 right-2 z-20 flex size-11 items-center justify-center"
        >
          <X className="size-5" />
        </button>
        <MediaFrame
          src={media.src}
          alt={media.alt}
          caption={media.isPlaceholder ? '[SAMPLE PRODUCT PHOTO]' : undefined}
          tag={media.isPlaceholder ? 'MEDIA PLACEHOLDER' : undefined}
          className="aspect-[4/5] w-full md:aspect-auto md:min-h-[560px]"
          sizes="(min-width: 768px) 440px, 100vw"
        />
        <div className="p-7 md:p-10">
          <p className="text-sage font-mono text-xs tracking-widest">PRODUCT {indexLabel}</p>
          <h3 className="text-forest mt-3 font-serif text-5xl leading-none">{product.name}</h3>
          <p className="text-ink/85 mt-6 text-[15px] leading-relaxed">{product.description}</p>
          <p className="text-sage mt-2 text-[13px]">
            Best for: {product.bestFor} · Grown in {product.originRegion}
          </p>
          <div className="border-forest/15 mt-8 border-t pt-8">
            <ProductPurchase product={product} showMaxNote />
          </div>
          <div className="mt-6">
            <Link
              href={`/products/${product.slug}`}
              onClick={onClose}
              className="link-underline text-forest inline-flex min-h-11 items-center gap-2 pb-1 text-xs font-semibold tracking-[0.2em] uppercase"
            >
              View full details &amp; batch
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

interface ProductSectionProps {
  products: PublicProductDto[]
}

export function ProductSection({ products }: ProductSectionProps) {
  const [previewSlug, setPreviewSlug] = useState<string | null>(null)
  const featured = products.slice(0, 6)
  const previewIndex = featured.findIndex((p) => p.slug === previewSlug)
  const preview = previewIndex >= 0 ? featured[previewIndex] : undefined

  return (
    <section id="shop" className="bg-ivory py-24 md:py-36">
      <div className="mx-auto max-w-[1400px] px-5 md:px-10">
        <Eyebrow>07 / The pantry</Eyebrow>
        <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-end">
          <h2 className="text-forest text-[clamp(2.75rem,6vw,5.5rem)] leading-[1] lg:col-span-8">
            <MaskLines lines={['Slow-pressed oils.', <em key="w">A world of flavour.</em>]} />
          </h2>
          <div className="flex flex-col items-start gap-4 lg:col-span-4 lg:pb-3">
            <p data-reveal className="text-sage max-w-sm text-lg leading-relaxed">
              Unhurried oils for the meals you make every day.
            </p>
            <Link
              href="/shop"
              className="link-underline text-forest inline-flex min-h-11 items-center gap-2 pb-1 text-xs font-semibold tracking-[0.2em] uppercase"
            >
              Browse full shop
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>

        {featured.length === 0 ? (
          <div className="border-forest/20 mt-16 border p-10 text-center">
            <p className="text-forest font-serif text-3xl">Catalogue coming soon</p>
            <p className="text-sage mt-2 text-sm">
              Fresh seasonal batches are being pressed. Check back shortly or browse our shop.
            </p>
          </div>
        ) : (
          <div
            data-stagger="0.12"
            className="-mx-5 mt-16 flex snap-x snap-mandatory gap-6 overflow-x-auto px-5 pb-4 md:mx-0 md:mt-24 md:grid md:grid-cols-2 md:gap-10 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3 lg:gap-8"
          >
            {featured.map((product, i) => (
              <ProductCard
                key={product.id}
                product={product}
                indexLabel={String(i + 1).padStart(2, '0')}
                onPreview={() => setPreviewSlug(product.slug)}
                className={cn(
                  'w-[82vw] shrink-0 snap-start sm:w-[46vw] md:w-auto',
                  i % 3 === 1 ? 'lg:mt-16' : undefined,
                )}
              />
            ))}
          </div>
        )}

        <div
          data-reveal
          className="border-forest/20 mt-24 grid gap-6 border-y py-10 md:grid-cols-12"
        >
          <p className="text-forest text-xs font-semibold tracking-[0.28em] uppercase md:col-span-3">
            Why the price?
          </p>
          <p className="text-forest max-w-2xl font-serif text-2xl leading-snug font-medium md:col-span-9 md:text-3xl">
            More whole seeds, less oil per batch, time to settle and independent testing. Prices
            shown include applicable taxes.
          </p>
        </div>
      </div>

      <AnimatePresence>
        {preview && (
          <ProductPreview
            key={preview.id}
            product={preview}
            indexLabel={String(previewIndex + 1).padStart(2, '0')}
            onClose={() => setPreviewSlug(null)}
          />
        )}
      </AnimatePresence>
    </section>
  )
}
