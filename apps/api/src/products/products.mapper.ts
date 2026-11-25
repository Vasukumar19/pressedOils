import {
  computePublicAvailability,
  formatDateIndia,
  type PublicBatchDto,
  type PublicProductDto,
  type PublicVariantAvailabilityDto,
  type PublicVariantDto,
} from '@pressedoils/shared'

export interface CatalogProductRecord {
  id: string
  slug: string
  name: string
  description: string
  best_for: string
  origin_region: string
  sort_order: number
  brand: string
  created_at: Date
  images: Array<{
    id: string
    url: string
    alt: string
    sort_order: number
  }>
  variants: Array<{
    id: string
    sku: string
    size_label: string
    price_paise: number
    mrp_paise: number
  }>
  batches: Array<{
    batch_no: string
    pressed_on: Date
    best_before: Date
    lab_report_url: string | null
    lab_tested_on: Date | null
  }>
}

export interface CachedCatalogVariant {
  id: string
  sku: string
  sizeLabel: string
  pricePaise: number
  mrpPaise: number
}

export interface CachedCatalogProduct {
  id: string
  slug: string
  name: string
  description: string
  bestFor: string
  originRegion: string
  sortOrder: number
  brand: string
  createdAtIso: string
  images: Array<{
    id: string
    url: string
    alt: string
    sortOrder: number
  }>
  variants: CachedCatalogVariant[]
  currentBatch: PublicBatchDto | null
}

export interface VariantAvailabilityRecord {
  id: string
  stock: number
  reserved: number
  low_stock_threshold: number
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function mapPublicBatch(
  batch: CatalogProductRecord['batches'][number] | undefined,
): PublicBatchDto | null {
  if (!batch) return null
  return {
    batchNo: batch.batch_no,
    pressedOn: toIsoDate(batch.pressed_on),
    bestBefore: toIsoDate(batch.best_before),
    pressedOnDisplay: formatDateIndia(batch.pressed_on),
    bestBeforeDisplay: formatDateIndia(batch.best_before),
    labReportUrl: batch.lab_report_url,
    labTestedOn: batch.lab_tested_on ? toIsoDate(batch.lab_tested_on) : null,
    labTestedOnDisplay: batch.lab_tested_on ? formatDateIndia(batch.lab_tested_on) : null,
  }
}

export function mapCatalogProduct(row: CatalogProductRecord): CachedCatalogProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    bestFor: row.best_for,
    originRegion: row.origin_region,
    sortOrder: row.sort_order,
    brand: row.brand,
    createdAtIso: row.created_at.toISOString(),
    images: row.images.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
      sortOrder: img.sort_order,
    })),
    variants: row.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      sizeLabel: v.size_label,
      pricePaise: v.price_paise,
      mrpPaise: v.mrp_paise,
    })),
    currentBatch: mapPublicBatch(row.batches[0]),
  }
}

export function mapPublicVariant(
  variant: CachedCatalogVariant,
  availRow: VariantAvailabilityRecord | undefined,
): PublicVariantDto {
  const availability = availRow
    ? computePublicAvailability(availRow.stock, availRow.reserved, availRow.low_stock_threshold)
    : { inStock: false, lowStock: false }

  return {
    id: variant.id,
    sku: variant.sku,
    sizeLabel: variant.sizeLabel,
    pricePaise: variant.pricePaise,
    mrpPaise: variant.mrpPaise,
    inStock: availability.inStock,
    lowStock: availability.lowStock,
    ...(availability.availableStock !== undefined
      ? { availableStock: availability.availableStock }
      : {}),
  }
}

export function mapPublicProduct(
  catalog: CachedCatalogProduct,
  availabilityByVariantId: Map<string, VariantAvailabilityRecord>,
): PublicProductDto {
  return {
    id: catalog.id,
    slug: catalog.slug,
    name: catalog.name,
    description: catalog.description,
    bestFor: catalog.bestFor,
    originRegion: catalog.originRegion,
    sortOrder: catalog.sortOrder,
    brand: catalog.brand,
    images: catalog.images.map((img) => ({
      id: img.id,
      url: img.url,
      alt: img.alt,
      sortOrder: img.sortOrder,
    })),
    variants: catalog.variants.map((v) => mapPublicVariant(v, availabilityByVariantId.get(v.id))),
    currentBatch: catalog.currentBatch
      ? {
          batchNo: catalog.currentBatch.batchNo,
          pressedOn: catalog.currentBatch.pressedOn,
          bestBefore: catalog.currentBatch.bestBefore,
          pressedOnDisplay: catalog.currentBatch.pressedOnDisplay,
          bestBeforeDisplay: catalog.currentBatch.bestBeforeDisplay,
          labReportUrl: catalog.currentBatch.labReportUrl,
          labTestedOn: catalog.currentBatch.labTestedOn,
          labTestedOnDisplay: catalog.currentBatch.labTestedOnDisplay,
        }
      : null,
  }
}

export function mapVariantAvailability(
  row: VariantAvailabilityRecord,
): PublicVariantAvailabilityDto {
  const availability = computePublicAvailability(row.stock, row.reserved, row.low_stock_threshold)
  return {
    variantId: row.id,
    inStock: availability.inStock,
    lowStock: availability.lowStock,
    ...(availability.availableStock !== undefined
      ? { availableStock: availability.availableStock }
      : {}),
  }
}
