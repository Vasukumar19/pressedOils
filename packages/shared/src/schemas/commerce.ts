import { z } from 'zod'
import { COUPON_TYPE, PAYMENT_METHOD } from '../enums'
import { indianPhoneSchema, indianPincodeSchema, paiseSchema } from './common'

export const cartItemInputSchema = z.object({
  variantId: z.string().uuid(),
  qty: z.number().int().min(1).max(99),
})

export type CartItemInput = z.infer<typeof cartItemInputSchema>

export const cartValidateRequestSchema = z.object({
  items: z.array(cartItemInputSchema).max(50),
  couponCode: z.string().trim().toUpperCase().max(32).optional(),
})

export type CartValidateRequest = z.infer<typeof cartValidateRequestSchema>

export const pincodeCheckQuerySchema = z.object({
  pincode: indianPincodeSchema,
})

export type PincodeCheckQuery = z.infer<typeof pincodeCheckQuerySchema>

export const addressInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: indianPhoneSchema,
  line1: z.string().trim().min(4).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  pincode: indianPincodeSchema,
})

export type AddressInput = z.infer<typeof addressInputSchema>

export const checkoutRequestSchema = z.object({
  contact: z.object({
    name: z.string().trim().min(2).max(120),
    phone: indianPhoneSchema,
    email: z.string().trim().email().max(160).optional(),
  }),
  address: addressInputSchema,
  items: z.array(cartItemInputSchema).min(1).max(50),
  paymentMethod: z.enum([PAYMENT_METHOD.ONLINE, PAYMENT_METHOD.COD]),
  couponCode: z.string().trim().toUpperCase().max(32).optional(),
  dpdpConsent: z.literal(true, {
    errorMap: () => ({ message: 'Privacy policy consent is required to place an order' }),
  }),
})

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

export const couponSchema = z.object({
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

export type CouponDto = z.infer<typeof couponSchema>

export const trackOrderQuerySchema = z.object({
  orderNumber: z.string().trim().min(4).max(40),
  phone: indianPhoneSchema,
})

export type TrackOrderQuery = z.infer<typeof trackOrderQuerySchema>

export const storeSettingsSchema = z.object({
  brandName: z.string().min(1),
  freeShippingThresholdPaise: paiseSchema,
  defaultShippingPaise: paiseSchema,
  gstRateBps: z.number().int().min(0).max(2800),
  gstIncludedInPrice: z.boolean(),
  fssaiNumber: z.string().min(1),
  supportEmail: z.string().min(1),
  supportPhone: z.string().min(1),
  registeredAddress: z.string().min(1),
})

export type StoreSettingsDto = z.infer<typeof storeSettingsSchema>
