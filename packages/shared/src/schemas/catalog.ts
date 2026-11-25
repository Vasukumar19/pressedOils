import { z } from 'zod'
import { isPlaceholderUrl, SIZE_LABELS } from '../constants'
import { dateOnlySchema, imageUrlSchema, paiseSchema, slugSchema, skuSchema } from './common'

export const productImageSchema = z.object({
  id: z.string().uuid(),
  url: imageUrlSchema,
  alt: z.string().min(1).max(240),
  sortOrder: z.number().int().nonnegative(),
})

export type ProductImageDto = z.infer<typeof productImageSchema>

export const variantSchema = z.object({
  id: z.string().uuid(),
  sku: skuSchema,
  sizeLabel: z.string().min(1).max(40),
  pricePaise: paiseSchema,
  mrpPaise: paiseSchema,
  stock: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative(),
  isActive: z.boolean(),
})

export type VariantDto = z.infer<typeof variantSchema>

export const batchSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  batchNo: z.string().trim().min(2).max(64),
  pressedOn: dateOnlySchema,
  bestBefore: dateOnlySchema,
  labReportUrl: imageUrlSchema.nullable(),
  labReportKey: z.string().nullable().optional(),
  labReportChecksum: z.string().nullable().optional(),
  labTestedOn: dateOnlySchema.nullable(),
  isCurrent: z.boolean(),
  isActive: z.boolean(),
  lockedAt: z.string().datetime().nullable().optional(),
})

export type BatchDto = z.infer<typeof batchSchema>

export const productSchema = z.object({
  id: z.string().uuid(),
  slug: slugSchema,
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(1).max(2000),
  bestFor: z.string().trim().min(1).max(300),
  originRegion: z.string().trim().min(1).max(160),
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  brand: z.string().trim().min(1).max(120),
  images: z.array(productImageSchema),
  variants: z.array(variantSchema),
  currentBatch: batchSchema.nullable(),
})

export type ProductDto = z.infer<typeof productSchema>

export const productListQuerySchema = z.object({
  inStockOnly: z.coerce.boolean().optional(),
  size: z.enum(SIZE_LABELS).optional(),
  minPricePaise: z.coerce.number().int().nonnegative().optional(),
  maxPricePaise: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(['featured', 'price_asc', 'price_desc', 'newest']).default('featured'),
})

export type ProductListQuery = z.infer<typeof productListQuerySchema>

export interface ProductActivationInput {
  images: Array<{ url: string }>
  variants: Array<{ isActive: boolean; pricePaise: number; stock: number }>
  batches: Array<{ isActive: boolean; isCurrent: boolean }>
}

export interface ProductActivationResult {
  allowed: boolean
  reasons: string[]
}

/**
 * Enforces the production activation rule:
 * A product cannot have is_active = true unless it has at least one non-placeholder image,
 * at least one active variant with price > 0 and stock > 0, and an active current batch.
 */
export function canActivateProduct(
  product: ProductActivationInput,
  options: { allowPlaceholders?: boolean } = {},
): ProductActivationResult {
  const reasons: string[] = []
  const allowPlaceholders = options.allowPlaceholders ?? false

  if (product.images.length === 0) {
    reasons.push('Product must have at least one image')
  } else if (!allowPlaceholders && product.images.some((img) => isPlaceholderUrl(img.url))) {
    reasons.push('Product images cannot point to /placeholders/ when activating')
  }

  const activeVariants = product.variants.filter((v) => v.isActive)
  if (activeVariants.length === 0) {
    reasons.push('Product must have at least one active variant')
  } else {
    const hasPricedInStockVariant = activeVariants.some((v) => v.pricePaise > 0 && v.stock > 0)
    if (!hasPricedInStockVariant) {
      reasons.push('At least one active variant must have price > 0 and stock > 0')
    }
  }

  const hasCurrentActiveBatch = product.batches.some((b) => b.isActive && b.isCurrent)
  if (!hasCurrentActiveBatch) {
    reasons.push('Product must have an active current batch assigned')
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  }
}
