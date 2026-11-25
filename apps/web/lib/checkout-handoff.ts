import type { CheckoutOrderSummaryDto } from '@pressedoils/shared'

let lastConfirmedOrderInMemory: CheckoutOrderSummaryDto | null = null

/**
 * Stores the confirmed order strictly in memory (never disk storage, URL, or analytics)
 * so the 6-digit pickup code is displayed once on transition to /checkout/success.
 */
export function setLastConfirmedOrder(order: CheckoutOrderSummaryDto): void {
  lastConfirmedOrderInMemory = order
}

export function getLastConfirmedOrder(
  expectedOrderNumber?: string,
): CheckoutOrderSummaryDto | null {
  if (!lastConfirmedOrderInMemory) return null
  if (expectedOrderNumber && lastConfirmedOrderInMemory.orderNumber !== expectedOrderNumber) {
    return null
  }
  return lastConfirmedOrderInMemory
}

export function clearLastConfirmedOrder(): void {
  lastConfirmedOrderInMemory = null
}
