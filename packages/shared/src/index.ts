/**
 * @pressedoils/shared
 *
 * Zod schemas, TypeScript types, enums and constants shared across
 * apps/web, apps/admin and apps/api.
 *
 * Phase 0: barrel only. Schemas added from Phase 1 onwards.
 */

// Order status enum — extended in Phase 1 with Prisma-compatible values
export const ORDER_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  COD_PENDING: 'COD_PENDING',
  PAID: 'PAID',
  CONFIRMED: 'CONFIRMED',
  PACKED: 'PACKED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS]

// Payment method enum
export const PAYMENT_METHOD = {
  ONLINE: 'ONLINE',
  COD: 'COD',
} as const

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD]

// Payment status enum
export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS]

// Currency — always INR, amounts always in paise (integer)
export const CURRENCY = 'INR' as const
