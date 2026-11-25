'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_MAX_QTY_PER_VARIANT,
  type PublicProductDto,
  type PublicVariantAvailabilityDto,
} from '@pressedoils/shared'
import { fetchLiveAvailability } from './api'

export function buildAvailabilityMapFromProducts(
  products: readonly PublicProductDto[],
): Record<string, PublicVariantAvailabilityDto> {
  const map: Record<string, PublicVariantAvailabilityDto> = {}
  for (const product of products) {
    for (const variant of product.variants) {
      map[variant.id] = {
        variantId: variant.id,
        inStock: variant.inStock,
        lowStock: variant.lowStock,
        ...(variant.availableStock !== undefined ? { availableStock: variant.availableStock } : {}),
      }
    }
  }
  return map
}

export function useLiveAvailability(
  variantIds: readonly string[],
  options: {
    initialMap?: Record<string, PublicVariantAvailabilityDto>
    initialMaxQty?: number
    enabled?: boolean
  } = {},
) {
  const { initialMap = {}, initialMaxQty = DEFAULT_MAX_QTY_PER_VARIANT, enabled = true } = options
  const idsKey = useMemo(
    () =>
      Array.from(new Set(variantIds.filter(Boolean)))
        .sort()
        .join(','),
    [variantIds],
  )
  const [availabilityMap, setAvailabilityMap] = useState<
    Record<string, PublicVariantAvailabilityDto>
  >(() => initialMap)
  const [maxOrderQtyPerVariant, setMaxOrderQtyPerVariant] = useState<number>(initialMaxQty)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    const ids = idsKey ? idsKey.split(',') : []
    if (!enabled || ids.length === 0) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setIsRefreshing(true)

    try {
      const response = await fetchLiveAvailability(ids, controller.signal)
      setMaxOrderQtyPerVariant(response.maxOrderQtyPerVariant)
      setAvailabilityMap((prev) => {
        const next = { ...prev }
        for (const item of response.items) {
          next[item.variantId] = item
        }
        return next
      })
    } catch {
      // Fail gracefully on transient client network blips; server state validates again at checkout
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setIsRefreshing(false)
      }
    }
  }, [enabled, idsKey])

  // Fetch live availability on page load and on window focus (no polling interval)
  useEffect(() => {
    if (!enabled || !idsKey) return
    void refresh()

    const onFocus = () => {
      void refresh()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      controllerRef.current?.abort()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, idsKey, refresh])

  return { availabilityMap, maxOrderQtyPerVariant, isRefreshing, refresh }
}
