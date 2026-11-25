import { z } from 'zod'
import { isPlaceholderUrl } from '../constants'

/** Money amounts are ALWAYS integer paise (never floats). */
export const paiseSchema = z
  .number({ invalid_type_error: 'Amount in paise must be an integer' })
  .int('Amount in paise must be an integer')
  .nonnegative('Amount in paise cannot be negative')

export const positivePaiseSchema = paiseSchema.positive('Amount in paise must be greater than zero')

/** Safe boolean query parser: only accepts true/false or 'true'/'false'. */
export const booleanQueryParamSchema = z.preprocess((val) => {
  if (val === 'true' || val === true) return true
  if (val === 'false' || val === false) return false
  return val
}, z.boolean())

/**
 * Indian 10-digit mobile number (starts with 6-9).
 * Accepts optional +91 / 91 / 0 prefix and spaces/hyphens, normalizes to +91XXXXXXXXXX.
 */
export const indianPhoneSchema = z
  .string()
  .trim()
  .transform((val) => val.replace(/[\s-]/g, ''))
  .transform((val) => {
    if (val.startsWith('+91') && val.length === 13) return val
    if (val.startsWith('91') && val.length === 12) return `+${val}`
    if (val.startsWith('0') && val.length === 11) return `+91${val.slice(1)}`
    if (/^[6-9]\d{9}$/.test(val)) return `+91${val}`
    return val
  })
  .refine((val) => /^\+91[6-9]\d{9}$/.test(val), {
    message: 'Enter a valid 10-digit Indian mobile number',
  })

/** 6-digit Indian PIN code (first digit 1-9). */
export const indianPincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit Indian pincode')

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case')

export const skuSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Z0-9-]+$/, 'SKU must use uppercase letters, numbers, and hyphens')

/** Accepts YYYY-MM-DD strings or Date objects for @db.Date fields. */
export const dateOnlySchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD date'),
  z.date(),
])

/** Any valid absolute HTTPS/HTTP URL or relative app path. */
export const imageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((val) => val.startsWith('/') || /^https?:\/\/.+/.test(val), {
    message: 'Image URL must be an absolute http(s) URL or a leading-slash path',
  })

/** Production product image URL — strictly refuses /placeholders/. */
export const productionImageUrlSchema = imageUrlSchema.refine((val) => !isPlaceholderUrl(val), {
  message: 'Placeholder images (/placeholders/) cannot be used in production',
})

export const apiErrorResponseSchema = z
  .object({
    statusCode: z.number().int(),
    error: z.string(),
    message: z.string(),
    code: z.string().optional(),
    captchaRequired: z.boolean().optional(),
    details: z.unknown().optional(),
    requestId: z.string(),
    timestamp: z.string(),
    path: z.string(),
  })
  .strict()

export type ApiErrorResponseDto = z.infer<typeof apiErrorResponseSchema>
