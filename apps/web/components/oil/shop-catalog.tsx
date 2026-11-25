'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  SIZE_LABELS,
  type ProductListQuery,
  type PublicProductDto,
  type PublicProductListResponseDto,
} from '@pressedoils/shared'
import { AnimatePresence } from 'motion/react'
import { ProductCard, ProductPreview } from './product-section'
import { Eyebrow } from './primitives'

interface ShopCatalogProps {
  data: PublicProductListResponseDto
  query: ProductListQuery
}

function buildShopHref(params: Partial<ProductListQuery>): string {
  const sp = new URLSearchParams()
  if (params.size) sp.set('size', params.size)
  if (params.inStockOnly) sp.set('inStockOnly', 'true')
  if (params.minPricePaise !== undefined) sp.set('minPricePaise', String(params.minPricePaise))
  if (params.maxPricePaise !== undefined) sp.set('maxPricePaise', String(params.maxPricePaise))
  if (params.sort && params.sort !== 'featured') sp.set('sort', params.sort)
  if (params.page && params.page > 1) sp.set('page', String(params.page))
  const qs = sp.toString()
  return qs ? `/shop?${qs}` : '/shop'
}

export function ShopCatalog({ data, query }: ShopCatalogProps) {
  const router = useRouter()
  const [previewSlug, setPreviewSlug] = useState<string | null>(null)
  const [minRupees, setMinRupees] = useState<string>(
    query.minPricePaise !== undefined ? String(Math.round(query.minPricePaise / 100)) : '',
  )
  const [maxRupees, setMaxRupees] = useState<string>(
    query.maxPricePaise !== undefined ? String(Math.round(query.maxPricePaise / 100)) : '',
  )
  const [priceError, setPriceError] = useState<string | null>(null)

  const previewIndex = data.items.findIndex((p) => p.slug === previewSlug)
  const preview: PublicProductDto | undefined =
    previewIndex >= 0 ? data.items[previewIndex] : undefined

  const hasFilters = Boolean(
    query.size ||
    query.inStockOnly ||
    query.minPricePaise !== undefined ||
    query.maxPricePaise !== undefined ||
    query.sort !== 'featured',
  )

  function navigate(next: Partial<ProductListQuery>) {
    router.push(buildShopHref({ ...query, page: 1, ...next }))
  }

  function onPriceSubmit(event: FormEvent) {
    event.preventDefault()
    const minVal = minRupees.trim() ? Number(minRupees.trim()) : undefined
    const maxVal = maxRupees.trim() ? Number(maxRupees.trim()) : undefined

    if (
      (minVal !== undefined && (!Number.isFinite(minVal) || minVal < 0)) ||
      (maxVal !== undefined && (!Number.isFinite(maxVal) || maxVal < 0))
    ) {
      setPriceError('Enter whole rupee amounts greater than or equal to 0.')
      return
    }
    if (minVal !== undefined && maxVal !== undefined && minVal > maxVal) {
      setPriceError('Minimum price cannot exceed maximum price.')
      return
    }

    setPriceError(null)
    navigate({
      minPricePaise: minVal !== undefined ? Math.round(minVal * 100) : undefined,
      maxPricePaise: maxVal !== undefined ? Math.round(maxVal * 100) : undefined,
    })
  }

  return (
    <div className="mx-auto max-w-[1400px] px-5 md:px-10">
      <header className="border-forest/15 border-b pb-10">
        <Eyebrow>Cold-Pressed Pantry</Eyebrow>
        <div className="mt-6 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <h1 className="text-forest font-serif text-5xl leading-[0.98] md:text-7xl">
              Shop all oils
            </h1>
            <p className="text-sage mt-4 max-w-xl text-base leading-relaxed">
              Pressed in small batches from single-origin seeds. Each bottle carries its batch
              number and pressing date.
            </p>
          </div>
          <p className="text-sage font-mono text-xs tracking-[0.2em] uppercase">
            {data.pagination.total} {data.pagination.total === 1 ? 'oil' : 'oils'} available
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate({ size: undefined })}
              className={`min-h-11 border px-4 text-xs font-medium tracking-[0.16em] uppercase transition-colors ${
                !query.size
                  ? 'border-forest bg-forest text-ivory'
                  : 'border-forest/30 text-forest hover:border-forest'
              }`}
            >
              All sizes
            </button>
            {SIZE_LABELS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => navigate({ size: query.size === size ? undefined : size })}
                className={`min-h-11 border px-4 text-xs font-medium tracking-[0.16em] uppercase transition-colors ${
                  query.size === size
                    ? 'border-forest bg-forest text-ivory'
                    : 'border-forest/30 text-forest hover:border-forest'
                }`}
              >
                {size}
              </button>
            ))}

            <button
              type="button"
              onClick={() => navigate({ inStockOnly: query.inStockOnly ? undefined : true })}
              aria-pressed={Boolean(query.inStockOnly)}
              className={`min-h-11 border px-4 text-xs font-medium tracking-[0.16em] uppercase transition-colors ${
                query.inStockOnly
                  ? 'border-gold bg-gold/25 text-forest'
                  : 'border-forest/30 text-forest hover:border-forest'
              }`}
            >
              In stock only
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <form onSubmit={onPriceSubmit} className="flex flex-wrap items-end gap-2">
              <label className="text-sage flex flex-col gap-1 text-[11px] tracking-[0.16em] uppercase">
                Min ₹
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={minRupees}
                  onChange={(e) => setMinRupees(e.target.value)}
                  placeholder="0"
                  className="border-forest/30 bg-ivory text-forest min-h-11 w-24 border px-3 text-sm tabular-nums"
                />
              </label>
              <label className="text-sage flex flex-col gap-1 text-[11px] tracking-[0.16em] uppercase">
                Max ₹
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={maxRupees}
                  onChange={(e) => setMaxRupees(e.target.value)}
                  placeholder="Any"
                  className="border-forest/30 bg-ivory text-forest min-h-11 w-24 border px-3 text-sm tabular-nums"
                />
              </label>
              <button
                type="submit"
                className="border-forest/30 text-forest hover:border-forest min-h-11 border px-4 text-xs font-medium tracking-[0.16em] uppercase transition-colors"
              >
                Apply
              </button>
            </form>

            <label className="text-sage flex flex-col gap-1 text-[11px] tracking-[0.16em] uppercase">
              Sort by
              <select
                value={query.sort}
                onChange={(e) => navigate({ sort: e.target.value as ProductListQuery['sort'] })}
                className="border-forest/30 bg-ivory text-forest min-h-11 border px-3 text-xs font-medium tracking-[0.12em] uppercase"
              >
                <option value="featured">Featured</option>
                <option value="price_asc">Price: Low to high</option>
                <option value="price_desc">Price: High to low</option>
                <option value="newest">Newest batch</option>
              </select>
            </label>

            {hasFilters ? (
              <Link
                href="/shop"
                onClick={() => {
                  setMinRupees('')
                  setMaxRupees('')
                  setPriceError(null)
                }}
                className="text-bronze hover:text-forest flex min-h-11 items-center px-2 text-xs font-medium tracking-[0.16em] uppercase underline underline-offset-4"
              >
                Reset
              </Link>
            ) : null}
          </div>
        </div>
        {priceError ? (
          <p role="alert" className="text-error mt-3 text-xs">
            {priceError}
          </p>
        ) : null}
      </header>

      {data.items.length === 0 ? (
        <div className="border-forest/20 mt-14 border p-12 text-center">
          <p className="text-forest font-serif text-3xl">No oils matched those filters</p>
          <p className="text-sage mt-2 text-sm">
            Try clearing a size or price filter to browse the complete cellar.
          </p>
          <Link
            href="/shop"
            className="bg-forest text-ivory hover:bg-ink mt-6 inline-flex min-h-11 items-center px-6 text-xs font-semibold tracking-[0.2em] uppercase transition-colors"
          >
            View all oils
          </Link>
        </div>
      ) : (
        <div className="mt-14 grid gap-12 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {data.items.map((product, i) => (
            <ProductCard
              key={product.id}
              product={product}
              indexLabel={String(
                (data.pagination.page - 1) * data.pagination.pageSize + i + 1,
              ).padStart(2, '0')}
              onPreview={() => setPreviewSlug(product.slug)}
            />
          ))}
        </div>
      )}

      {data.pagination.totalPages > 1 ? (
        <nav
          aria-label="Shop pagination"
          className="border-forest/15 mt-16 flex items-center justify-between border-t pt-8"
        >
          <Link
            href={buildShopHref({ ...query, page: Math.max(1, data.pagination.page - 1) })}
            aria-disabled={data.pagination.page <= 1}
            className={`inline-flex min-h-11 items-center border px-5 text-xs font-semibold tracking-[0.18em] uppercase ${
              data.pagination.page <= 1
                ? 'border-forest/15 text-sage/50 pointer-events-none'
                : 'border-forest/30 text-forest hover:border-forest'
            }`}
          >
            Previous
          </Link>
          <span className="text-sage font-mono text-xs tracking-widest uppercase">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <Link
            href={buildShopHref({
              ...query,
              page: Math.min(data.pagination.totalPages, data.pagination.page + 1),
            })}
            aria-disabled={data.pagination.page >= data.pagination.totalPages}
            className={`inline-flex min-h-11 items-center border px-5 text-xs font-semibold tracking-[0.18em] uppercase ${
              data.pagination.page >= data.pagination.totalPages
                ? 'border-forest/15 text-sage/50 pointer-events-none'
                : 'border-forest/30 text-forest hover:border-forest'
            }`}
          >
            Next
          </Link>
        </nav>
      ) : null}

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
    </div>
  )
}
