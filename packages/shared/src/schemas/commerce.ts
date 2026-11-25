import { z } from 'zod'
import { CURRENCY, DEFAULT_MAX_QTY_PER_VARIANT } from '../constants'
import { COUPON_TYPE, PAYMENT_METHOD } from '../enums'
import { indianPhoneSchema, indianPincodeSchema, paiseSchema } from './common'

export function createCartItemInputSchema(maxQty: number = DEFAULT_MAX_QTY_PER_VARIANT) {
  return z
    .object({
      variantId: z.string().uuid(),
      qty: z.number().int().min(1).max(maxQty),
    })
    .strict()
}

export const cartItemInputSchema = createCartItemInputSchema(DEFAULT_MAX_QTY_PER_VARIANT)

export type CartItemInput = z.infer<typeof cartItemInputSchema>

export const cartValidateRequestSchema = z
  .object({
    items: z.array(cartItemInputSchema).max(50),
    couponCode: z.string().trim().toUpperCase().max(32).optional(),
  })
  .strict()

export type CartValidateRequest = z.infer<typeof cartValidateRequestSchema>

export const pincodeCheckParamSchema = z
  .object({
    pincode: indianPincodeSchema,
  })
  .strict()

export type PincodeCheckParam = z.infer<typeof pincodeCheckParamSchema>

/** Consistent response shape for both serviceable and non-serviceable pincodes. */
export const pincodeLookupResponseSchema = z
  .object({
    pincode: indianPincodeSchema,
    serviceable: z.boolean(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    deliveryDays: z.number().int().positive().nullable(),
    codAllowed: z.boolean(),
    shippingPaise: paiseSchema.nullable(),
  })
  .strict()

export type PincodeLookupResponseDto = z.infer<typeof pincodeLookupResponseSchema>

export const addressInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: indianPhoneSchema,
    line1: z.string().trim().min(4).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    pincode: indianPincodeSchema,
  })
  .strict()

export type AddressInput = z.infer<typeof addressInputSchema>

export const checkoutRequestSchema = z
  .object({
    contact: z
      .object({
        name: z.string().trim().min(2).max(120),
        phone: indianPhoneSchema,
        email: z.string().trim().email().max(160).optional(),
      })
      .strict(),
    address: addressInputSchema,
    items: z.array(cartItemInputSchema).min(1).max(50),
    paymentMethod: z.enum([PAYMENT_METHOD.ONLINE, PAYMENT_METHOD.COD]),
    couponCode: z.string().trim().toUpperCase().max(32).optional(),
    dpdpConsent: z.literal(true, {
      errorMap: () => ({ message: 'Privacy policy consent is required to place an order' }),
    }),
  })
  .strict()

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(32)
      .regex(/^[A-Z0-9_-]+$/),
    type: z.enum([COUPON_TYPE.PERCENT, COUPON_TYPE.FLAT]),
    value: z.number().int().positive(),
    minOrderPaise: paiseSchema,
    isActive: z.boolean(),
  })
  .strict()

export type CouponDto = z.infer<typeof couponSchema>

export const trackOrderQuerySchema = z
  .object({
    orderNumber: z.string().trim().min(4).max(40),
    phone: indianPhoneSchema,
  })
  .strict()

export type TrackOrderQuery = z.infer<typeof trackOrderQuerySchema>

export const publicSettingsResponseSchema = z
  .object({
    brandName: z.string().min(1),
    currency: z.literal(CURRENCY),
    freeShippingThresholdPaise: paiseSchema,
    defaultShippingPaise: paiseSchema,
    gstRateBps: z.number().int().min(0).max(2800),
    gstIncludedInPrice: z.boolean(),
    fssaiNumber: z.string().min(1),
    supportEmail: z.string().min(1),
    supportPhone: z.string().min(1),
    registeredAddress: z.string().min(1),
    maxQtyPerVariant: z.number().int().positive(),
    showSampleDataBanner: z.boolean(),
  })
  .strict()

export type PublicSettingsResponseDto = z.infer<typeof publicSettingsResponseSchema>

export const healthLivenessResponseSchema = z
  .object({
    status: z.literal('ok'),
    timestamp: z.string(),
    uptime: z.number().nonnegative(),
  })
  .strict()

export type HealthLivenessResponseDto = z.infer<typeof healthLivenessResponseSchema>

export const healthReadinessResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'down']),
    checks: z
      .object({
        database: z.enum(['ok', 'down']),
        redis: z.enum(['ok', 'degraded']),
      })
      .strict(),
    timestamp: z.string(),
  })
  .strict()

export type HealthReadinessResponseDto = z.infer<typeof healthReadinessResponseSchema>
