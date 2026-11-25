import { z } from 'zod'
import {
  DEFAULT_PAGE_SIZE,
  isPlaceholderUrl,
  isTrustedLabReportUrl,
  MAX_PAGE_SIZE,
  SIZE_LABELS,
} from '../constants'
import {
  booleanQueryParamSchema,
  dateOnlySchema,
  imageUrlSchema,
  paiseSchema,
  slugSchema,
  skuSchema,
} from './common'

export const productImageSchema = z
  .object({
    id: z.string().uuid(),
    url: imageUrlSchema,
    alt: z.string().min(1).max(240),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict()

export type ProductImageDto = z.infer<typeof productImageSchema>

/** Internal variant schema (used in admin/internal domain checks, never public API). */
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

export interface PublicAvailability {
  inStock: boolean
  lowStock: boolean
  availableStock?: number
}

/**
 * Computes public availability without leaking raw inventory counts.
 * Returns availableStock ONLY when 1 <= available <= lowStockThreshold.
 * Never exposes stock or reserved.
 */
export function computePublicAvailability(
  stock: number,
  reserved: number,
  lowStockThreshold: number,
): PublicAvailability {
  const available = Math.max(0, stock - reserved)
  if (available === 0) {
    return { inStock: false, lowStock: false }
  }
  if (available <= lowStockThreshold) {
    return { inStock: true, lowStock: true, availableStock: available }
  }
  return { inStock: true, lowStock: false }
}

export const publicVariantAvailabilitySchema = z
  .object({
    variantId: z.string().uuid(),
    inStock: z.boolean(),
    lowStock: z.boolean(),
    availableStock: z.number().int().positive().optional(),
  })
  .strict()

export type PublicVariantAvailabilityDto = z.infer<typeof publicVariantAvailabilitySchema>

export const publicVariantSchema = z
  .object({
    id: z.string().uuid(),
    sku: skuSchema,
    sizeLabel: z.string().min(1).max(40),
    pricePaise: paiseSchema,
    mrpPaise: paiseSchema,
    inStock: z.boolean(),
    lowStock: z.boolean(),
    availableStock: z.number().int().positive().optional(),
  })
  .strict()

export type PublicVariantDto = z.infer<typeof publicVariantSchema>

export const publicBatchSchema = z
  .object({
    batchNo: z.string().trim().min(2).max(64),
    pressedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    bestBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pressedOnDisplay: z.string(),
    bestBeforeDisplay: z.string(),
    labReportUrl: imageUrlSchema.nullable(),
    labTestedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    labTestedOnDisplay: z.string().nullable(),
  })
  .strict()

export type PublicBatchDto = z.infer<typeof publicBatchSchema>

export const publicProductSchema = z
  .object({
    id: z.string().uuid(),
    slug: slugSchema,
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().min(1).max(2000),
    bestFor: z.string().trim().min(1).max(300),
    originRegion: z.string().trim().min(1).max(160),
    sortOrder: z.number().int().nonnegative(),
    brand: z.string().trim().min(1).max(120),
    images: z.array(productImageSchema),
    variants: z.array(publicVariantSchema),
    currentBatch: publicBatchSchema.nullable(),
  })
  .strict()

export type PublicProductDto = z.infer<typeof publicProductSchema>

export const paginationMetaSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict()

export const publicProductListResponseSchema = z
  .object({
    items: z.array(publicProductSchema),
    pagination: paginationMetaSchema,
  })
  .strict()

export type PublicProductListResponseDto = z.infer<typeof publicProductListResponseSchema>

export const publicAvailabilityResponseSchema = z
  .object({
    items: z.array(publicVariantAvailabilitySchema),
    maxOrderQtyPerVariant: z.number().int().positive(),
  })
  .strict()

export type PublicAvailabilityResponseDto = z.infer<typeof publicAvailabilityResponseSchema>

export const productListQuerySchema = z
  .object({
    inStockOnly: booleanQueryParamSchema.optional(),
    size: z.enum(SIZE_LABELS).optional(),
    minPricePaise: z.coerce.number().int().nonnegative().optional(),
    maxPricePaise: z.coerce.number().int().nonnegative().optional(),
    sort: z.enum(['featured', 'price_asc', 'price_desc', 'newest']).default('featured'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (
      q.minPricePaise !== undefined &&
      q.maxPricePaise !== undefined &&
      q.minPricePaise > q.maxPricePaise
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minPricePaise'],
        message: 'minPricePaise cannot be greater than maxPricePaise',
      })
    }
  })

export type ProductListQuery = z.infer<typeof productListQuerySchema>

export const productAvailabilityQuerySchema = z
  .object({
    variantIds: z
      .string()
      .trim()
      .min(1)
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().uuid()).min(1).max(50)),
  })
  .strict()

export type ProductAvailabilityQuery = z.infer<typeof productAvailabilityQuerySchema>

export interface ProductActivationInput {
  images: Array<{ url: string }>
  variants: Array<{ isActive: boolean; pricePaise: number; stock: number }>
  batches: Array<{ isActive: boolean; isCurrent: boolean; labReportUrl?: string | null }>
}

export interface ProductActivationResult {
  allowed: boolean
  reasons: string[]
}

/**
 * Enforces the production activation rule:
 * A product cannot have is_active = true unless it has at least one non-placeholder image,
 * at least one active variant with price > 0 and stock > 0, an active current batch,
 * and (when requireLabReportForActivation is enabled) a trusted HTTPS lab report URL.
 */
export function canActivateProduct(
  product: ProductActivationInput,
  options: {
    allowPlaceholders?: boolean
    requireLabReportForActivation?: boolean
    allowedReportDomains?: readonly string[]
  } = {},
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

  const currentBatch = product.batches.find((b) => b.isActive && b.isCurrent)
  if (!currentBatch) {
    reasons.push('Product must have an active current batch assigned')
  } else if (!allowPlaceholders && options.requireLabReportForActivation) {
    if (!isTrustedLabReportUrl(currentBatch.labReportUrl, options.allowedReportDomains ?? [])) {
      reasons.push(
        'Current batch must have a valid HTTPS lab report URL on an allowed CDN/storage domain',
      )
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  }
}
