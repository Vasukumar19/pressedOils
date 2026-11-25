import { z } from 'zod'
import { CURRENCY, DEFAULT_MAX_QTY_PER_VARIANT } from '../constants'
import { COUPON_TYPE, FULFILMENT_METHOD, PAYMENT_METHOD } from '../enums'
import { indianPhoneSchema, indianPincodeSchema, paiseSchema, positivePaiseSchema } from './common'

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

export const cartValidateItemInputSchema = z
  .object({
    variantId: z.string().uuid(),
    qty: z.number().int().min(1).max(1000),
  })
  .strict()

export const cartValidateRequestSchema = z
  .object({
    items: z.array(cartValidateItemInputSchema).max(50),
    couponCode: z.string().trim().toUpperCase().max(32).optional(),
    fulfilmentMethod: z
      .enum([FULFILMENT_METHOD.DELIVERY, FULFILMENT_METHOD.STORE_PICKUP])
      .default(FULFILMENT_METHOD.DELIVERY),
    pincode: indianPincodeSchema.optional(),
    pickupLocationId: z.string().uuid().optional(),
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

export const pickupLocationPublicSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    address: z.string().min(1),
    hours: z.string().min(1),
    prepTimeMinutes: z.number().int().positive(),
    isSample: z.boolean(),
  })
  .strict()

export type PickupLocationPublicDto = z.infer<typeof pickupLocationPublicSchema>

export const cartItemStatusSchema = z.enum([
  'OK',
  'ADJUSTED_QTY',
  'QUANTITY_UNAVAILABLE',
  'OUT_OF_STOCK',
  'UNAVAILABLE',
])

export type CartItemStatus = z.infer<typeof cartItemStatusSchema>

export const cartValidatedLineSchema = z
  .object({
    variantId: z.string().uuid(),
    productId: z.string().uuid(),
    productSlug: z.string(),
    productName: z.string(),
    sizeLabel: z.string(),
    sku: z.string(),
    imageUrl: z.string().nullable(),
    imageAlt: z.string(),
    requestedQty: z.number().int().positive(),
    effectiveQty: z.number().int().nonnegative(),
    unitPricePaise: paiseSchema,
    mrpPaise: paiseSchema.nullable(),
    lineSubtotalPaise: paiseSchema,
    lineDiscountPaise: paiseSchema,
    lineNetPaise: paiseSchema,
    inStock: z.boolean(),
    lowStock: z.boolean(),
    availableStock: z.number().int().positive().optional(),
    status: cartItemStatusSchema,
    statusMessage: z.string().nullable(),
  })
  .strict()

export type CartValidatedLineDto = z.infer<typeof cartValidatedLineSchema>

export const cartCouponResultSchema = z
  .object({
    applied: z.boolean(),
    code: z.string(),
    discountPaise: paiseSchema,
    message: z.string(),
  })
  .strict()

export type CartCouponResultDto = z.infer<typeof cartCouponResultSchema>

export const cartTaxBreakdownSchema = z.discriminatedUnion('showTaxBreakdown', [
  z
    .object({
      showTaxBreakdown: z.literal(true),
      rateBps: z.number().int().min(0).max(2800),
      includedInPrice: z.boolean(),
      taxPaise: paiseSchema,
    })
    .strict(),
  z
    .object({
      showTaxBreakdown: z.literal(false),
    })
    .strict(),
])

export type CartTaxBreakdownDto = z.infer<typeof cartTaxBreakdownSchema>

export const cartValidateResponseSchema = z
  .object({
    items: z.array(cartValidatedLineSchema),
    fulfilmentMethod: z.enum([FULFILMENT_METHOD.DELIVERY, FULFILMENT_METHOD.STORE_PICKUP]),
    pickup: z
      .object({
        location: pickupLocationPublicSchema,
        estimatedReadyDisplay: z.string(),
      })
      .strict()
      .nullable(),
    pincode: pincodeLookupResponseSchema.nullable(),
    coupon: cartCouponResultSchema.nullable(),
    freeShipping: z
      .object({
        enabled: z.literal(true),
        qualified: z.boolean(),
        thresholdPaise: paiseSchema,
        remainingPaise: paiseSchema,
      })
      .strict()
      .nullable(),
    tax: cartTaxBreakdownSchema,
    summary: z
      .object({
        itemsSubtotalPaise: paiseSchema,
        discountPaise: paiseSchema,
        netItemsTotalPaise: paiseSchema,
        shippingPaise: paiseSchema.nullable(),
        shippingStatus: z.enum(['CALCULATED', 'ENTER_PINCODE', 'UNSERVICEABLE', 'PICKUP_FREE']),
        taxAddedPaise: paiseSchema,
        totalPaise: paiseSchema,
        totalLabel: z.enum(['Items total', 'Total']),
        canCheckout: z.boolean(),
      })
      .strict(),
    maxOrderQtyPerVariant: z.number().int().positive(),
  })
  .strict()

export type CartValidateResponseDto = z.infer<typeof cartValidateResponseSchema>

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
    fulfilmentMethod: z
      .enum([FULFILMENT_METHOD.DELIVERY, FULFILMENT_METHOD.STORE_PICKUP])
      .default(FULFILMENT_METHOD.DELIVERY),
    address: addressInputSchema.optional(),
    pickupLocationId: z.string().uuid().optional(),
    items: z.array(cartItemInputSchema).min(1).max(50),
    paymentMethod: z.enum([PAYMENT_METHOD.ONLINE, PAYMENT_METHOD.COD]),
    couponCode: z.string().trim().toUpperCase().max(32).optional(),
    dpdpConsent: z.literal(true, {
      errorMap: () => ({ message: 'Privacy policy consent is required to place an order' }),
    }),
    marketingConsent: z.boolean().default(false),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.fulfilmentMethod === FULFILMENT_METHOD.DELIVERY && !data.address) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['address'],
        message: 'Delivery address is required for home delivery orders',
      })
    }
  })

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

export const checkoutVerifyRequestSchema = z
  .object({
    orderId: z.string().uuid(),
    razorpayOrderId: z.string().trim().min(1).max(100),
    razorpayPaymentId: z.string().trim().min(1).max(100),
    razorpaySignature: z.string().trim().min(1).max(256),
  })
  .strict()

export type CheckoutVerifyRequest = z.infer<typeof checkoutVerifyRequestSchema>

export const checkoutFailRequestSchema = z
  .object({
    orderId: z.string().uuid(),
    orderToken: z.string().trim().min(16).max(256),
    reason: z.enum(['PAYMENT_FAILED', 'MODAL_DISMISSED', 'CANCELLED']).default('PAYMENT_FAILED'),
    errorDescription: z.string().trim().max(300).optional(),
  })
  .strict()

export type CheckoutFailRequest = z.infer<typeof checkoutFailRequestSchema>

export const checkoutOrderItemSummarySchema = z
  .object({
    variantId: z.string().uuid(),
    productName: z.string(),
    sizeLabel: z.string(),
    qty: z.number().int().positive(),
    unitPricePaise: paiseSchema,
    discountPaise: paiseSchema,
    lineTotalPaise: paiseSchema,
  })
  .strict()

export const checkoutOrderSummarySchema = z
  .object({
    id: z.string().uuid(),
    orderNumber: z.string().regex(/^ORD-\d{6}-[2-9A-HJ-NP-Z]{5}$/),
    fulfilmentMethod: z.enum([FULFILMENT_METHOD.DELIVERY, FULFILMENT_METHOD.STORE_PICKUP]),
    paymentMethod: z.enum([PAYMENT_METHOD.ONLINE, PAYMENT_METHOD.COD]),
    paymentStatus: z.enum(['PENDING', 'CAPTURED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED']),
    refundedPaise: paiseSchema.default(0),
    orderStatus: z.enum([
      'PENDING_PAYMENT',
      'COD_PENDING',
      'PAID',
      'CONFIRMED',
      'PACKED',
      'SHIPPED',
      'DELIVERED',
      'READY_FOR_PICKUP',
      'PICKED_UP',
      'CANCELLED',
      'REFUNDED',
    ]),
    itemsSubtotalPaise: paiseSchema,
    discountPaise: paiseSchema,
    netItemsTotalPaise: paiseSchema,
    shippingPaise: paiseSchema,
    codFeePaise: paiseSchema,
    taxAddedPaise: paiseSchema,
    totalPaise: paiseSchema,
    tax: cartTaxBreakdownSchema,
    couponCode: z.string().nullable(),
    pickup: z
      .object({
        location: pickupLocationPublicSchema,
        estimatedReadyDisplay: z.string(),
      })
      .strict()
      .nullable(),
    pickupCode: z.string().nullable(),
    reservationExpiresAt: z.string().nullable(),
    needsAttention: z.boolean(),
    dpdpPolicyVersion: z.string().nullable(),
    marketingConsent: z.boolean(),
    createdAt: z.string(),
    items: z.array(checkoutOrderItemSummarySchema),
  })
  .strict()

export type CheckoutOrderSummaryDto = z.infer<typeof checkoutOrderSummarySchema>

export const checkoutPaymentSessionSchema = z
  .object({
    gateway: z.enum(['razorpay', 'mock']),
    keyId: z.string(),
    gatewayOrderId: z.string(),
    checkoutToken: z.string().min(16),
    amountPaise: paiseSchema,
    currency: z.literal(CURRENCY),
    brandName: z.string(),
    prefill: z
      .object({
        name: z.string(),
        contact: z.string(),
        email: z.string().optional(),
      })
      .strict(),
    reservationExpiresAt: z.string(),
  })
  .strict()

export const checkoutResponseSchema = z
  .object({
    order: checkoutOrderSummarySchema,
    payment: checkoutPaymentSessionSchema.nullable(),
  })
  .strict()

export type CheckoutResponseDto = z.infer<typeof checkoutResponseSchema>

export const checkoutVerifyResponseSchema = z
  .object({
    order: checkoutOrderSummarySchema,
    alreadyProcessed: z.boolean(),
    autoRefunded: z.boolean(),
    message: z.string(),
  })
  .strict()

export type CheckoutVerifyResponseDto = z.infer<typeof checkoutVerifyResponseSchema>

export const checkoutFailResponseSchema = z
  .object({
    orderId: z.string().uuid(),
    orderNumber: z.string(),
    orderStatus: z.enum(['PENDING_PAYMENT', 'CANCELLED', 'PAID', 'CONFIRMED', 'COD_PENDING']),
    released: z.boolean(),
    message: z.string(),
  })
  .strict()

export type CheckoutFailResponseDto = z.infer<typeof checkoutFailResponseSchema>

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
    maxDiscountPaise: z.number().int().positive().nullable().optional(),
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

export const ownerUpdateSettingsSchema = z
  .object({
    freeShipping: z
      .object({
        enabled: z.boolean(),
        thresholdPaise: paiseSchema.optional(),
        startsAt: z.string().datetime().nullable().optional(),
        endsAt: z.string().datetime().nullable().optional(),
      })
      .strict()
      .optional(),
    storePickup: z
      .object({
        enabled: z.boolean(),
        payAtStoreEnabled: z.boolean().optional(),
        holdWindowDays: z.number().int().min(1).max(14).optional(),
      })
      .strict()
      .optional(),
    taxDisplay: z
      .object({
        showTaxBreakdown: z.boolean(),
      })
      .strict()
      .optional(),
    cod: z
      .object({
        enabled: z.boolean(),
        feePaise: paiseSchema.optional(),
        maxOrderPaise: paiseSchema.optional(),
        maxActiveOrdersPerPhone: z.number().int().min(1).max(20).optional(),
      })
      .strict()
      .optional(),
    legalPages: z
      .object({
        approved: z.boolean(),
        privacyVersion: z.string().trim().min(1).max(40).optional(),
        termsVersion: z.string().trim().min(1).max(40).optional(),
        shippingPolicyVersion: z.string().trim().min(1).max(40).optional(),
      })
      .strict()
      .optional(),
    autoConfirmPaidOrders: z
      .object({
        enabled: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      Boolean(
        v.freeShipping ||
        v.storePickup ||
        v.taxDisplay ||
        v.cod ||
        v.legalPages ||
        v.autoConfirmPaidOrders,
      ),
    'At least one setting group must be provided',
  )

export type OwnerUpdateSettingsDto = z.infer<typeof ownerUpdateSettingsSchema>

export const webhookAckResponseSchema = z
  .object({
    received: z.literal(true),
    duplicate: z.boolean(),
    eventId: z.string(),
    outcome: z.enum(['PROCESSED', 'DUPLICATE', 'IGNORED', 'MISMATCH_ALERTED', 'RECORDED']),
  })
  .strict()

export type WebhookAckResponseDto = z.infer<typeof webhookAckResponseSchema>

export const adminConfirmOrderSchema = z
  .object({
    reason: z.string().trim().min(3).max(300).optional(),
  })
  .strict()

export type AdminConfirmOrderDto = z.infer<typeof adminConfirmOrderSchema>

export const adminCancelOrderSchema = z
  .object({
    reason: z.string().trim().min(3).max(300),
  })
  .strict()

export type AdminCancelOrderDto = z.infer<typeof adminCancelOrderSchema>

export const adminRefundOrderSchema = z
  .object({
    amountPaise: positivePaiseSchema.optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict()

export type AdminRefundOrderDto = z.infer<typeof adminRefundOrderSchema>

export const adminReturnStockSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            variantId: z.string().uuid(),
            qty: z.number().int().positive(),
            condition: z.enum(['SEALED_RESTOCK', 'DAMAGED_WRITEOFF']),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    reason: z.string().trim().min(3).max(300),
  })
  .strict()

export type AdminReturnStockDto = z.infer<typeof adminReturnStockSchema>

export const adminCancelOrderResponseSchema = z
  .object({
    orderId: z.string().uuid(),
    orderNumber: z.string(),
    orderStatus: z.literal('CANCELLED'),
    restoredUnits: z.number().int().nonnegative(),
    refundInitiated: z.boolean(),
    refundId: z.string().uuid().nullable(),
    gatewayRefundId: z.string().nullable(),
  })
  .strict()

export type AdminCancelOrderResponseDto = z.infer<typeof adminCancelOrderResponseSchema>

export const adminRefundOrderResponseSchema = z
  .object({
    refundId: z.string().uuid(),
    orderId: z.string().uuid(),
    orderNumber: z.string(),
    amountPaise: positivePaiseSchema,
    status: z.enum(['PENDING', 'PROCESSED', 'FAILED']),
    gatewayRefundId: z.string().nullable(),
    remainingRefundablePaise: paiseSchema,
  })
  .strict()

export type AdminRefundOrderResponseDto = z.infer<typeof adminRefundOrderResponseSchema>

export const adminReturnStockResponseSchema = z
  .object({
    orderId: z.string().uuid(),
    restockedUnits: z.number().int().nonnegative(),
    writtenOffUnits: z.number().int().nonnegative(),
  })
  .strict()

export type AdminReturnStockResponseDto = z.infer<typeof adminReturnStockResponseSchema>

export const publicSettingsResponseSchema = z
  .object({
    brandName: z.string().min(1),
    currency: z.literal(CURRENCY),
    freeShippingEnabled: z.boolean(),
    freeShippingThresholdPaise: paiseSchema.nullable(),
    defaultShippingPaise: paiseSchema,
    gstRateBps: z.number().int().min(0).max(2800),
    gstIncludedInPrice: z.boolean(),
    showTaxBreakdown: z.boolean(),
    storePickupEnabled: z.boolean(),
    payAtStoreEnabled: z.boolean(),
    pickupLocations: z.array(pickupLocationPublicSchema),
    codEnabled: z.boolean(),
    codFeePaise: paiseSchema,
    codMaxOrderPaise: paiseSchema.nullable(),
    legalPagesApproved: z.boolean(),
    dpdpPolicyVersion: z.string().min(1),
    autoConfirmPaidOrders: z.boolean(),
    checkoutEnabled: z.boolean(),
    paymentGateway: z.enum(['razorpay', 'mock']),
    fssaiNumber: z.string().min(1),
    supportEmail: z.string().min(1),
    supportPhone: z.string().min(1),
    registeredAddress: z.string().min(1),
    maxQtyPerVariant: z.number().int().positive(),
    requireLabReportForActivation: z.boolean(),
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
