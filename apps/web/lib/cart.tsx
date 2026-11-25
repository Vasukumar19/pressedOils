'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { SIZES, getProduct, type Size } from '@/lib/products'

export interface CartLine {
  productId: string
  size: Size
  qty: number
}

interface CartContextValue {
  lines: CartLine[]
  count: number
  subtotal: number
  hasUnpriced: boolean
  isOpen: boolean
  setOpen: (open: boolean) => void
  add: (productId: string, size: Size, qty?: number) => void
  setQty: (productId: string, size: Size, qty: number) => void
  remove: (productId: string, size: Size) => void
}

const STORAGE_KEY = 'cold-pressed-bag-v1'
const CartContext = createContext<CartContextValue | null>(null)

function isValidLine(line: unknown): line is CartLine {
  if (!line || typeof line !== 'object') return false
  const l = line as CartLine
  return (
    !!getProduct(l.productId) &&
    (SIZES as readonly string[]).includes(l.size) &&
    Number.isInteger(l.qty) &&
    l.qty >= 1 &&
    l.qty <= 99
  )
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)
  const [isOpen, setOpen] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setLines(parsed.filter(isValidLine))
      }
    } catch {
      /* ignore corrupt storage */
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    } catch {
      /* storage unavailable */
    }
  }, [lines, ready])

  const add = useCallback((productId: string, size: Size, qty = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === productId && l.size === size)
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, qty: Math.min(99, l.qty + qty) } : l))
      }
      return [...prev, { productId, size, qty }]
    })
  }, [])

  const setQty = useCallback((productId: string, size: Size, qty: number) => {
    setLines((prev) =>
      qty < 1
        ? prev.filter((l) => !(l.productId === productId && l.size === size))
        : prev.map((l) =>
            l.productId === productId && l.size === size ? { ...l, qty: Math.min(99, qty) } : l,
          ),
    )
  }, [])

  const remove = useCallback((productId: string, size: Size) => {
    setLines((prev) => prev.filter((l) => !(l.productId === productId && l.size === size)))
  }, [])

  const value = useMemo<CartContextValue>(() => {
    let count = 0
    let subtotal = 0
    let hasUnpriced = false
    for (const line of lines) {
      count += line.qty
      const price = getProduct(line.productId)?.prices[line.size] ?? null
      if (price === null) hasUnpriced = true
      else subtotal += price * line.qty
    }
    return { lines, count, subtotal, hasUnpriced, isOpen, setOpen, add, setQty, remove }
  }, [lines, isOpen, add, setQty, remove])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
