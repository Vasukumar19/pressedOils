import { describe, expect, it } from 'vitest'
import {
  addCartStoredItem,
  CART_STORAGE_KEY,
  parseStoredCart,
  serializeStoredCart,
  setCartStoredItemQty,
} from './cart'

const VAR_A = '550e8400-e29b-41d4-a716-446655440001'
const VAR_B = '550e8400-e29b-41d4-a716-446655440002'

describe('cart:v2 storage validation and item mutations', () => {
  it('uses the versioned cart:v2 storage key', () => {
    expect(CART_STORAGE_KEY).toBe('cart:v2')
  })

  it('parses valid v2 cart items containing only variantId and qty', () => {
    const raw = serializeStoredCart([
      { variantId: VAR_A, qty: 2 },
      { variantId: VAR_B, qty: 1 },
    ])
    expect(parseStoredCart(raw, 10)).toEqual({
      items: [
        { variantId: VAR_A, qty: 2 },
        { variantId: VAR_B, qty: 1 },
      ],
      discarded: false,
    })
  })

  it('discards corrupt JSON, legacy v1 objects, extra price fields, or out-of-range qty without throwing', () => {
    expect(parseStoredCart('{not json', 10)).toEqual({ items: [], discarded: true })
    expect(
      parseStoredCart(JSON.stringify([{ productId: 'groundnut', size: '1 L', qty: 1 }]), 10),
    ).toEqual({ items: [], discarded: true })
    expect(
      parseStoredCart(JSON.stringify([{ variantId: VAR_A, qty: 1, unitPricePaise: 99999 }]), 10),
    ).toEqual({ items: [], discarded: true })
    expect(parseStoredCart(JSON.stringify([{ variantId: VAR_A, qty: 11 }]), 10)).toEqual({
      items: [],
      discarded: true,
    })
    expect(parseStoredCart(JSON.stringify([{ variantId: VAR_A, qty: 0 }]), 10)).toEqual({
      items: [],
      discarded: true,
    })
    expect(parseStoredCart(null, 10)).toEqual({ items: [], discarded: false })
  })

  it('adds, sets, caps at maxQty, and removes items cleanly', () => {
    let items = addCartStoredItem([], VAR_A, 3, 10)
    items = addCartStoredItem(items, VAR_A, 9, 10)
    expect(items).toEqual([{ variantId: VAR_A, qty: 10 }])

    items = setCartStoredItemQty(items, VAR_A, 4, 10)
    expect(items).toEqual([{ variantId: VAR_A, qty: 4 }])

    items = setCartStoredItemQty(items, VAR_A, 0, 10)
    expect(items).toEqual([])
  })
})
