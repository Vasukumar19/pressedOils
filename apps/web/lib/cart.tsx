'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_MAX_QTY_PER_VARIANT,
  publicProductListResponseSchema,
  type PublicProductDto,
  type PublicSettingsResponseDto,
  type PublicVariantAvailabilityDto,
  type PublicVariantDto,
} from '@pressedoils/shared'
import { z } from 'zod'
import { getPublicApiBaseUrl } from './env'
import { buildAvailabilityMapFromProducts, useLiveAvailability } from './use-live-availability'

export const CART_STORAGE_KEY = 'cart:v2' as const

export interface CartStoredItem {
  variantId: string
  qty: number
}

export interface CatalogVariantEntry {
  productId: string
  productSlug: string
  productName: string
  originRegion: string
  imageUrl: string | null
  imageAlt: string
  variant: PublicVariantDto
}

export interface CartLine {
  variantId: string
  qty: number
  productId: string
  productSlug: string
  productName: string
  sizeLabel: string
  sku: string
  unitPricePaise: number
  mrpPaise: number | null
  lineTotalPaise: number
  imageUrl: string | null
  imageAlt: string
  availability: PublicVariantAvailabilityDto
}

export function createCartStoredItemSchema(maxQty: number) {
  return z
    .object({
      variantId: z.string().uuid(),
      qty: z.number().int().min(1).max(maxQty),
    })
    .strict()
}

export function createCartStorageSchema(maxQty: number) {
  return z.array(createCartStoredItemSchema(maxQty)).max(50)
}

export function normalizeCartItems(
  items: readonly CartStoredItem[],
  maxQty: number = DEFAULT_MAX_QTY_PER_VARIANT,
): CartStoredItem[] {
  const byVariant = new Map<string, number>()
  for (const item of items) {
    const prev = byVariant.get(item.variantId) ?? 0
    const next = Math.min(maxQty, Math.max(0, prev + item.qty))
    if (next > 0) {
      byVariant.set(item.variantId, next)
    }
  }
  return Array.from(byVariant.entries()).map(([variantId, qty]) => ({ variantId, qty }))
}

export function parseStoredCart(
  raw: string | null,
  maxQty: number = DEFAULT_MAX_QTY_PER_VARIANT,
): { items: CartStoredItem[]; discarded: boolean } {
  if (!raw || raw.trim() === '') {
    return { items: [], discarded: false }
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { items: [], discarded: true }
  }

  const parsed = createCartStorageSchema(maxQty).safeParse(json)
  if (!parsed.success) {
    return { items: [], discarded: true }
  }

  return {
    items: normalizeCartItems(parsed.data, maxQty),
    discarded: false,
  }
}

export function serializeStoredCart(
  items: readonly CartStoredItem[],
  maxQty: number = DEFAULT_MAX_QTY_PER_VARIANT,
): string {
  return JSON.stringify(normalizeCartItems(items, maxQty))
}

export function addCartStoredItem(
  items: readonly CartStoredItem[],
  variantId: string,
  deltaQty: number,
  maxQty: number = DEFAULT_MAX_QTY_PER_VARIANT,
): CartStoredItem[] {
  if (!Number.isInteger(deltaQty) || deltaQty <= 0) return [...items]
  const idx = items.findIndex((i) => i.variantId === variantId)
  if (idx === -1) {
    return [...items, { variantId, qty: Math.min(maxQty, deltaQty) }]
  }
  return items.map((item, i) =>
    i === idx ? { ...item, qty: Math.min(maxQty, item.qty + deltaQty) } : item,
  )
}

export function setCartStoredItemQty(
  items: readonly CartStoredItem[],
  variantId: string,
  qty: number,
  maxQty: number = DEFAULT_MAX_QTY_PER_VARIANT,
): CartStoredItem[] {
  if (!Number.isInteger(qty) || qty <= 0) {
    return items.filter((item) => item.variantId !== variantId)
  }
  const clamped = Math.min(maxQty, qty)
  const exists = items.some((item) => item.variantId === variantId)
  if (!exists) {
    return [...items, { variantId, qty: clamped }]
  }
  return items.map((item) => (item.variantId === variantId ? { ...item, qty: clamped } : item))
}

interface CartContextValue {
  items: CartStoredItem[]
  lines: CartLine[]
  count: number
  subtotalPaise: number
  isOpen: boolean
  setOpen: (open: boolean) => void
  add: (variantId: string, qty?: number) => void
  setQty: (variantId: string, qty: number) => void
  remove: (variantId: string) => void
  clear: () => void
  registerProducts: (products: readonly PublicProductDto[]) => void
  getVariantAvailability: (variant: PublicVariantDto) => PublicVariantAvailabilityDto
  getVariantQty: (variantId: string) => number
  maxOrderQtyPerVariant: number
  freeShippingThresholdPaise: number
  hasUnresolvedItems: boolean
  refreshAvailability: () => Promise<void>
}

const CartContext = createContext<CartContextValue | null>(null)

function indexCatalogProducts(
  products: readonly PublicProductDto[],
): Record<string, CatalogVariantEntry> {
  const index: Record<string, CatalogVariantEntry> = {}
  for (const product of products) {
    const primaryImage = product.images[0] ?? null
    for (const variant of product.variants) {
      index[variant.id] = {
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        originRegion: product.originRegion,
        imageUrl: primaryImage?.url ?? null,
        imageAlt: primaryImage?.alt ?? product.name,
        variant,
      }
    }
  }
  return index
}

interface CartProviderProps {
  children: ReactNode
  initialProducts?: PublicProductDto[]
  initialSettings?: PublicSettingsResponseDto
}

export function CartProvider({
  children,
  initialProducts = [],
  initialSettings,
}: CartProviderProps) {
  const configuredMaxQty = initialSettings?.maxQtyPerVariant ?? DEFAULT_MAX_QTY_PER_VARIANT
  const [items, setItems] = useState<CartStoredItem[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [isOpen, setOpen] = useState(false)
  const [catalogMap, setCatalogMap] = useState<Record<string, CatalogVariantEntry>>(() =>
    indexCatalogProducts(initialProducts),
  )
  const hydratedCatalogRef = useRef(false)

  const registerProducts = useCallback((products: readonly PublicProductDto[]) => {
    if (products.length === 0) return
    setCatalogMap((prev) => ({
      ...prev,
      ...indexCatalogProducts(products),
    }))
  }, [])

  useEffect(() => {
    registerProducts(initialProducts)
  }, [initialProducts, registerProducts])

  // Load persisted cart:v2 safely on mount and keep synchronized across tabs
  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const raw = window.localStorage.getItem(CART_STORAGE_KEY)
        const parsed = parseStoredCart(raw, configuredMaxQty)
        if (parsed.discarded) {
          window.localStorage.removeItem(CART_STORAGE_KEY)
        }
        setItems(parsed.items)
      } catch {
        setItems([])
      } finally {
        setHydrated(true)
      }
    }

    queueMicrotask(loadFromStorage)

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== CART_STORAGE_KEY) return
      const parsed = parseStoredCart(event.newValue, configuredMaxQty)
      setItems(parsed.items)
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [configuredMaxQty])

  // Hydrate catalog names and prices from the public API if cart has any variant not yet indexed
  useEffect(() => {
    if (!hydrated || hydratedCatalogRef.current) return
    const missingVariant = items.some((item) => !catalogMap[item.variantId])
    if (!missingVariant) return

    hydratedCatalogRef.current = true
    const controller = new AbortController()

    fetch(`${getPublicApiBaseUrl()}/products?pageSize=24`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (!json) return
        const parsed = publicProductListResponseSchema.safeParse(json)
        if (parsed.success) {
          registerProducts(parsed.data.items)
        }
      })
      .catch(() => {
        // Ignore transient hydration failure; user can retry or refresh page
      })

    return () => controller.abort()
  }, [catalogMap, hydrated, items, registerProducts])

  const trackedVariantIds = useMemo(() => {
    const set = new Set<string>(Object.keys(catalogMap))
    for (const item of items) set.add(item.variantId)
    return Array.from(set)
  }, [catalogMap, items])

  const initialAvailabilityMap = useMemo(
    () => buildAvailabilityMapFromProducts(initialProducts),
    [initialProducts],
  )

  const {
    availabilityMap,
    maxOrderQtyPerVariant,
    refresh: refreshAvailability,
  } = useLiveAvailability(trackedVariantIds, {
    initialMap: initialAvailabilityMap,
    initialMaxQty: configuredMaxQty,
    enabled: hydrated,
  })

  // Refresh availability whenever drawer opens with items
  useEffect(() => {
    if (!isOpen || items.length === 0) return
    void refreshAvailability()
  }, [isOpen, items.length, refreshAvailability])

  const persistItems = useCallback(
    (next: CartStoredItem[]) => {
      setItems(next)
      try {
        window.localStorage.setItem(
          CART_STORAGE_KEY,
          serializeStoredCart(next, maxOrderQtyPerVariant),
        )
      } catch {
        // Ignore quota / private browsing errors
      }
    },
    [maxOrderQtyPerVariant],
  )

  const add = useCallback(
    (variantId: string, qty = 1) => {
      setItems((prev) => {
        const next = addCartStoredItem(prev, variantId, qty, maxOrderQtyPerVariant)
        try {
          window.localStorage.setItem(
            CART_STORAGE_KEY,
            serializeStoredCart(next, maxOrderQtyPerVariant),
          )
        } catch {
          // Ignore storage error
        }
        return next
      })
      void refreshAvailability()
    },
    [maxOrderQtyPerVariant, refreshAvailability],
  )

  const setQty = useCallback(
    (variantId: string, qty: number) => {
      setItems((prev) => {
        const next = setCartStoredItemQty(prev, variantId, qty, maxOrderQtyPerVariant)
        try {
          window.localStorage.setItem(
            CART_STORAGE_KEY,
            serializeStoredCart(next, maxOrderQtyPerVariant),
          )
        } catch {
          // Ignore storage error
        }
        return next
      })
    },
    [maxOrderQtyPerVariant],
  )

  const remove = useCallback(
    (variantId: string) => {
      persistItems(items.filter((item) => item.variantId !== variantId))
    },
    [items, persistItems],
  )

  const clear = useCallback(() => {
    persistItems([])
  }, [persistItems])

  const getVariantAvailability = useCallback(
    (variant: PublicVariantDto): PublicVariantAvailabilityDto => {
      return (
        availabilityMap[variant.id] ?? {
          variantId: variant.id,
          inStock: variant.inStock,
          lowStock: variant.lowStock,
          ...(variant.availableStock !== undefined
            ? { availableStock: variant.availableStock }
            : {}),
        }
      )
    },
    [availabilityMap],
  )

  const getVariantQty = useCallback(
    (variantId: string) => items.find((i) => i.variantId === variantId)?.qty ?? 0,
    [items],
  )

  const lines = useMemo<CartLine[]>(() => {
    const resolved: CartLine[] = []
    for (const item of items) {
      const entry = catalogMap[item.variantId]
      if (!entry) continue
      const availability = getVariantAvailability(entry.variant)
      resolved.push({
        variantId: item.variantId,
        qty: item.qty,
        productId: entry.productId,
        productSlug: entry.productSlug,
        productName: entry.productName,
        sizeLabel: entry.variant.sizeLabel,
        sku: entry.variant.sku,
        unitPricePaise: entry.variant.pricePaise,
        mrpPaise: entry.variant.mrpPaise,
        lineTotalPaise: entry.variant.pricePaise * item.qty,
        imageUrl: entry.imageUrl,
        imageAlt: entry.imageAlt,
        availability,
      })
    }
    return resolved
  }, [catalogMap, getVariantAvailability, items])

  const hasUnresolvedItems = useMemo(
    () => hydrated && items.some((item) => !catalogMap[item.variantId]),
    [catalogMap, hydrated, items],
  )

  const count = useMemo(() => items.reduce((sum, item) => sum + item.qty, 0), [items])
  const subtotalPaise = useMemo(
    () => lines.reduce((sum, line) => sum + line.lineTotalPaise, 0),
    [lines],
  )

  const freeShippingThresholdPaise = initialSettings?.freeShippingThresholdPaise ?? 0

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      lines,
      count,
      subtotalPaise,
      isOpen,
      setOpen,
      add,
      setQty,
      remove,
      clear,
      registerProducts,
      getVariantAvailability,
      getVariantQty,
      maxOrderQtyPerVariant,
      freeShippingThresholdPaise,
      hasUnresolvedItems,
      refreshAvailability,
    }),
    [
      add,
      clear,
      count,
      freeShippingThresholdPaise,
      getVariantAvailability,
      getVariantQty,
      hasUnresolvedItems,
      isOpen,
      items,
      lines,
      maxOrderQtyPerVariant,
      refreshAvailability,
      registerProducts,
      remove,
      setQty,
      subtotalPaise,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
