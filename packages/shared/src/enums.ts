export const ORDER_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  COD_PENDING: 'COD_PENDING',
  PAID: 'PAID',
  CONFIRMED: 'CONFIRMED',
  PACKED: 'PACKED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  PICKED_UP: 'PICKED_UP',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS]

export const FULFILMENT_METHOD = {
  DELIVERY: 'DELIVERY',
  STORE_PICKUP: 'STORE_PICKUP',
} as const

export type FulfilmentMethod = (typeof FULFILMENT_METHOD)[keyof typeof FULFILMENT_METHOD]

export const PAYMENT_METHOD = {
  ONLINE: 'ONLINE',
  COD: 'COD',
} as const

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD]

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS]

export const RESERVATION_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
} as const

export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS]

export const COUPON_TYPE = {
  PERCENT: 'PERCENT',
  FLAT: 'FLAT',
} as const

export type CouponType = (typeof COUPON_TYPE)[keyof typeof COUPON_TYPE]

export const ADMIN_ROLE = {
  OWNER: 'OWNER',
  STAFF: 'STAFF',
} as const

export type AdminRole = (typeof ADMIN_ROLE)[keyof typeof ADMIN_ROLE]

export const STOCK_MOVEMENT_REASON = {
  INITIAL_SEED: 'INITIAL_SEED',
  RESERVE: 'RESERVE',
  SALE: 'SALE',
  RELEASE: 'RELEASE',
  CANCEL: 'CANCEL',
  ADJUSTMENT: 'ADJUSTMENT',
  RETURN: 'RETURN',
} as const

export type StockMovementReason = (typeof STOCK_MOVEMENT_REASON)[keyof typeof STOCK_MOVEMENT_REASON]

/**
 * Valid order status transitions per business rules:
 * Delivery:     PACKED -> SHIPPED -> DELIVERED
 * Store Pickup: PACKED -> READY_FOR_PICKUP -> PICKED_UP
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [ORDER_STATUS.PENDING_PAYMENT]: [ORDER_STATUS.PAID, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.COD_PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAID]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.PACKED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.PACKED]: [
    ORDER_STATUS.SHIPPED,
    ORDER_STATUS.READY_FOR_PICKUP,
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.REFUNDED,
  ],
  [ORDER_STATUS.SHIPPED]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.DELIVERED]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.READY_FOR_PICKUP]: [
    ORDER_STATUS.PICKED_UP,
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.REFUNDED,
  ],
  [ORDER_STATUS.PICKED_UP]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REFUNDED]: [],
}

export function canTransitionOrderStatus(
  from: OrderStatus,
  to: OrderStatus,
  fulfilmentMethod?: FulfilmentMethod,
): boolean {
  if (
    fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP &&
    from === ORDER_STATUS.PACKED &&
    to === ORDER_STATUS.SHIPPED
  ) {
    return false
  }
  if (
    fulfilmentMethod === FULFILMENT_METHOD.DELIVERY &&
    from === ORDER_STATUS.PACKED &&
    to === ORDER_STATUS.READY_FOR_PICKUP
  ) {
    return false
  }
  return ORDER_STATUS_TRANSITIONS[from].includes(to)
}
