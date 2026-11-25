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
  FULFILMENT_METHOD,
  publicProductListResponseSchema,
  type CartValidateResponseDto,
  type FulfilmentMethod,
  type PickupLocationPublicDto,
  type PublicProductDto,
  type PublicSettingsResponseDto,
  type PublicVariantAvailabilityDto,
  type PublicVariantDto,
} from '@pressedoils/shared'
import { z } from 'zod'
import { validateCartOnServer } from './api'
import { getPublicApiBaseUrl } from './env'
import { buildAvailabilityMapFromProducts, useLiveAvailability } from './use-live-availability'

export const CART_STORAGE_KEY = 'cart:v2' as const
export const CART_SESSION_STORAGE_KEY = 'cart:session' as const
export const CART_PREFS_STORAGE_KEY = 'cart:prefs:v1' as const

const cartPrefsSchema = z
  .object({
    fulfilmentMethod: z
      .enum([FULFILMENT_METHOD.DELIVERY, FULFILMENT_METHOD.STORE_PICKUP])
      .optional(),
    pickupLocationId: z.string().uuid().optional(),
    pincode: z.string().max(6).optional(),
    couponCode: z.string().max(32).optional(),
  })
  .strict()

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
  freeShippingEnabled: boolean
  freeShippingThresholdPaise: number | null
  storePickupEnabled: boolean
  payAtStoreEnabled: boolean
  pickupLocations: PickupLocationPublicDto[]
  codEnabled: boolean
  codFeePaise: number
  codMaxOrderPaise: number | null
  legalPagesApproved: boolean
  dpdpPolicyVersion: string
  smsOtpReady: boolean
  checkoutEnabled: boolean
  paymentGateway: 'razorpay' | 'mock'
  getSessionToken: () => string | undefined
  setSessionToken: (token: string | null) => void
  fulfilmentMethod: FulfilmentMethod
  setFulfilmentMethod: (method: FulfilmentMethod) => void
  pickupLocationId: string | undefined
  setPickupLocationId: (id: string) => void
  pincode: string
  setPincode: (pincode: string) => void
  couponCode: string
  setCouponCode: (code: string) => void
  validation: CartValidateResponseDto | null
  isValidating: boolean
  validateError: string | null
  revalidateCartNow: (overrides?: {
    couponCode?: string
    pincode?: string
    fulfilmentMethod?: FulfilmentMethod
    pickupLocationId?: string
  }) => Promise<void>
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

const VALIDATE_DEBOUNCE_MS = 350

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
  const [fulfilmentMethod, setFulfilmentMethod] = useState<FulfilmentMethod>(
    FULFILMENT_METHOD.DELIVERY,
  )
  const [pickupLocationId, setPickupLocationId] = useState<string | undefined>(
    () => initialSettings?.pickupLocations[0]?.id,
  )
  const [pincode, setPincode] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [validation, setValidation] = useState<CartValidateResponseDto | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [validateError, setValidateError] = useState<string | null>(null)
  const hydratedCatalogRef = useRef(false)
  const validateControllerRef = useRef<AbortController | null>(null)

  const storePickupEnabled = Boolean(
    initialSettings?.storePickupEnabled && (initialSettings?.pickupLocations.length ?? 0) > 0,
  )
  const pickupLocations = useMemo(
    () => (storePickupEnabled ? (initialSettings?.pickupLocations ?? []) : []),
    [initialSettings?.pickupLocations, storePickupEnabled],
  )

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

  // Load persisted cart:v2 and cart:prefs:v1 safely on mount
  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const raw = window.localStorage.getItem(CART_STORAGE_KEY)
        const parsed = parseStoredCart(raw, configuredMaxQty)
        if (parsed.discarded) {
          window.localStorage.removeItem(CART_STORAGE_KEY)
        }
        setItems(parsed.items)

        const rawPrefs = window.sessionStorage.getItem(CART_PREFS_STORAGE_KEY)
        if (rawPrefs) {
          const parsedPrefs = cartPrefsSchema.safeParse(JSON.parse(rawPrefs))
          if (parsedPrefs.success) {
            if (parsedPrefs.data.fulfilmentMethod) {
              setFulfilmentMethod(parsedPrefs.data.fulfilmentMethod)
            }
            if (parsedPrefs.data.pickupLocationId) {
              setPickupLocationId(parsedPrefs.data.pickupLocationId)
            }
            if (typeof parsedPrefs.data.pincode === 'string') {
              setPincode(parsedPrefs.data.pincode)
            }
            if (typeof parsedPrefs.data.couponCode === 'string') {
              setCouponCode(parsedPrefs.data.couponCode)
            }
          } else {
            window.sessionStorage.removeItem(CART_PREFS_STORAGE_KEY)
          }
        }
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

  // Hydrate catalog names/images if cart contains any variant not yet indexed
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
        // Ignore transient hydration errors
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
    maxOrderQtyPerVariant: liveMaxQty,
    refresh: refreshAvailability,
  } = useLiveAvailability(trackedVariantIds, {
    initialMap: initialAvailabilityMap,
    initialMaxQty: configuredMaxQty,
    enabled: hydrated,
  })

  const maxOrderQtyPerVariant = validation?.maxOrderQtyPerVariant ?? liveMaxQty

  const persistItems = useCallback(
    (next: CartStoredItem[]) => {
      setItems(next)
      try {
        window.localStorage.setItem(
          CART_STORAGE_KEY,
          serializeStoredCart(next, maxOrderQtyPerVariant),
        )
      } catch {
        // Ignore storage error
      }
    },
    [maxOrderQtyPerVariant],
  )

  const runServerValidation = useCallback(
    async (overrides?: {
      items?: CartStoredItem[]
      couponCode?: string
      pincode?: string
      fulfilmentMethod?: FulfilmentMethod
      pickupLocationId?: string
    }) => {
      const targetItems = overrides?.items ?? items
      if (targetItems.length === 0) {
        setValidation(null)
        setValidateError(null)
        return
      }

      validateControllerRef.current?.abort()
      const controller = new AbortController()
      validateControllerRef.current = controller
      setIsValidating(true)
      setValidateError(null)

      const activeCoupon = (overrides?.couponCode ?? couponCode).trim().toUpperCase()
      const activePincode = (overrides?.pincode ?? pincode).trim()
      const activeFulfilment = storePickupEnabled
        ? (overrides?.fulfilmentMethod ?? fulfilmentMethod)
        : FULFILMENT_METHOD.DELIVERY
      const activePickupId = overrides?.pickupLocationId ?? pickupLocationId

      let sessionToken: string | undefined
      try {
        sessionToken = window.localStorage.getItem(CART_SESSION_STORAGE_KEY) ?? undefined
      } catch {
        sessionToken = undefined
      }

      try {
        const result = await validateCartOnServer(
          {
            items: targetItems,
            fulfilmentMethod: activeFulfilment,
            ...(activeCoupon ? { couponCode: activeCoupon } : {}),
            ...(activeFulfilment === FULFILMENT_METHOD.DELIVERY &&
            /^[1-9][0-9]{5}$/.test(activePincode)
              ? { pincode: activePincode }
              : {}),
            ...(activeFulfilment === FULFILMENT_METHOD.STORE_PICKUP && activePickupId
              ? { pickupLocationId: activePickupId }
              : {}),
          },
          { sessionToken, signal: controller.signal },
        )

        if (result.nextSessionToken) {
          try {
            window.localStorage.setItem(CART_SESSION_STORAGE_KEY, result.nextSessionToken)
          } catch {
            // Ignore storage write restriction
          }
        }

        setValidation(result.data)

        // Sync local storage ONLY for explicit auto-clamps (<= low_stock_threshold or > MAX_QTY_PER_VARIANT);
        // never silently change QUANTITY_UNAVAILABLE (> low_stock_threshold) counts.
        const adjusted = result.data.items.filter(
          (line) => line.status === 'ADJUSTED_QTY' && line.effectiveQty > 0,
        )
        if (adjusted.length > 0) {
          const adjustById = new Map(adjusted.map((l) => [l.variantId, l.effectiveQty]))
          let changed = false
          const nextStored = targetItems.map((entry) => {
            const clampedQty = adjustById.get(entry.variantId)
            if (clampedQty !== undefined && clampedQty !== entry.qty) {
              changed = true
              return { ...entry, qty: clampedQty }
            }
            return entry
          })
          if (changed) {
            persistItems(nextStored)
          }
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return
        setValidateError(
          err instanceof Error ? err.message : 'Could not verify live bag totals right now.',
        )
      } finally {
        if (validateControllerRef.current === controller) {
          validateControllerRef.current = null
          setIsValidating(false)
        }
      }
    },
    [
      couponCode,
      fulfilmentMethod,
      items,
      persistItems,
      pickupLocationId,
      pincode,
      storePickupEnabled,
    ],
  )

  // Debounced server validation while drawer is open or items change cleanly
  useEffect(() => {
    if (!hydrated || !isOpen) return
    if (items.length === 0) {
      setValidation(null)
      return
    }
    const timer = window.setTimeout(() => {
      void runServerValidation()
    }, VALIDATE_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    couponCode,
    fulfilmentMethod,
    hydrated,
    isOpen,
    items,
    pickupLocationId,
    pincode,
    runServerValidation,
  ])

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

  useEffect(() => {
    if (!hydrated) return
    try {
      window.sessionStorage.setItem(
        CART_PREFS_STORAGE_KEY,
        JSON.stringify({
          fulfilmentMethod,
          ...(pickupLocationId ? { pickupLocationId } : {}),
          pincode,
          couponCode,
        }),
      )
    } catch {
      // Ignore storage error
    }
  }, [couponCode, fulfilmentMethod, hydrated, pickupLocationId, pincode])

  const getSessionToken = useCallback((): string | undefined => {
    try {
      return window.sessionStorage.getItem(CART_SESSION_STORAGE_KEY) ?? undefined
    } catch {
      return undefined
    }
  }, [])

  const setSessionToken = useCallback((token: string | null) => {
    try {
      if (token) {
        window.sessionStorage.setItem(CART_SESSION_STORAGE_KEY, token)
      } else {
        window.sessionStorage.removeItem(CART_SESSION_STORAGE_KEY)
      }
    } catch {
      // Ignore storage error
    }
  }, [])

  const clear = useCallback(() => {
    persistItems([])
    setValidation(null)
    setCouponCode('')
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
    const validatedById = new Map((validation?.items ?? []).map((l) => [l.variantId, l]))
    const resolved: CartLine[] = []
    for (const item of items) {
      const serverLine = validatedById.get(item.variantId)
      const entry = catalogMap[item.variantId]
      if (!entry && !serverLine) continue

      const unitPricePaise = serverLine
        ? serverLine.unitPricePaise
        : (entry?.variant.pricePaise ?? 0)
      const mrpPaise = serverLine ? serverLine.mrpPaise : (entry?.variant.mrpPaise ?? null)
      const lineTotalPaise = serverLine ? serverLine.lineSubtotalPaise : unitPricePaise * item.qty
      const availability: PublicVariantAvailabilityDto = serverLine
        ? {
            variantId: serverLine.variantId,
            inStock: serverLine.inStock,
            lowStock: serverLine.lowStock,
            ...(serverLine.availableStock !== undefined
              ? { availableStock: serverLine.availableStock }
              : {}),
          }
        : getVariantAvailability(entry!.variant)

      resolved.push({
        variantId: item.variantId,
        qty: item.qty,
        productId: serverLine?.productId ?? entry!.productId,
        productSlug: serverLine?.productSlug ?? entry!.productSlug,
        productName: serverLine?.productName ?? entry!.productName,
        sizeLabel: serverLine?.sizeLabel ?? entry!.variant.sizeLabel,
        sku: serverLine?.sku ?? entry!.variant.sku,
        unitPricePaise,
        mrpPaise,
        lineTotalPaise,
        imageUrl: serverLine?.imageUrl ?? entry?.imageUrl ?? null,
        imageAlt: serverLine?.imageAlt ?? entry?.imageAlt ?? 'Cold-pressed oil bottle',
        availability,
      })
    }
    return resolved
  }, [catalogMap, getVariantAvailability, items, validation?.items])

  const hasUnresolvedItems = useMemo(
    () => hydrated && items.some((item) => !catalogMap[item.variantId]) && !validation,
    [catalogMap, hydrated, items, validation],
  )

  const count = useMemo(() => items.reduce((sum, item) => sum + item.qty, 0), [items])
  const subtotalPaise = useMemo(
    () =>
      validation?.summary.itemsSubtotalPaise ??
      lines.reduce((sum, line) => sum + line.lineTotalPaise, 0),
    [lines, validation?.summary.itemsSubtotalPaise],
  )

  const freeShippingEnabled = Boolean(initialSettings?.freeShippingEnabled)
  const freeShippingThresholdPaise = initialSettings?.freeShippingThresholdPaise ?? null
  const payAtStoreEnabled = Boolean(storePickupEnabled && initialSettings?.payAtStoreEnabled)
  const codEnabled = Boolean(initialSettings?.codEnabled)
  const codFeePaise = initialSettings?.codFeePaise ?? 0
  const codMaxOrderPaise = initialSettings?.codMaxOrderPaise ?? null
  const legalPagesApproved = Boolean(initialSettings?.legalPagesApproved)
  const dpdpPolicyVersion = initialSettings?.dpdpPolicyVersion ?? '2026-11-draft-v1'
  const smsOtpReady = Boolean(initialSettings?.smsOtpReady ?? true)
  const checkoutEnabled = initialSettings?.checkoutEnabled ?? true
  const paymentGateway = initialSettings?.paymentGateway ?? 'mock'

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
      freeShippingEnabled,
      freeShippingThresholdPaise,
      storePickupEnabled,
      payAtStoreEnabled,
      pickupLocations,
      codEnabled,
      codFeePaise,
      codMaxOrderPaise,
      legalPagesApproved,
      dpdpPolicyVersion,
      smsOtpReady,
      checkoutEnabled,
      paymentGateway,
      getSessionToken,
      setSessionToken,
      fulfilmentMethod: storePickupEnabled ? fulfilmentMethod : FULFILMENT_METHOD.DELIVERY,
      setFulfilmentMethod,
      pickupLocationId,
      setPickupLocationId,
      pincode,
      setPincode,
      couponCode,
      setCouponCode,
      validation,
      isValidating,
      validateError,
      revalidateCartNow: runServerValidation,
      hasUnresolvedItems,
      refreshAvailability,
    }),
    [
      add,
      checkoutEnabled,
      clear,
      codEnabled,
      codFeePaise,
      codMaxOrderPaise,
      count,
      couponCode,
      dpdpPolicyVersion,
      freeShippingEnabled,
      freeShippingThresholdPaise,
      fulfilmentMethod,
      getSessionToken,
      getVariantAvailability,
      getVariantQty,
      hasUnresolvedItems,
      isOpen,
      isValidating,
      items,
      legalPagesApproved,
      lines,
      maxOrderQtyPerVariant,
      payAtStoreEnabled,
      paymentGateway,
      pickupLocationId,
      pickupLocations,
      pincode,
      refreshAvailability,
      registerProducts,
      remove,
      runServerValidation,
      setQty,
      setSessionToken,
      smsOtpReady,
      storePickupEnabled,
      subtotalPaise,
      validateError,
      validation,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
