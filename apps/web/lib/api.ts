import {
  type CartValidateRequest,
  cartValidateResponseSchema,
  type CartValidateResponseDto,
  type CheckoutFailRequest,
  checkoutFailResponseSchema,
  type CheckoutFailResponseDto,
  type CheckoutRequest,
  checkoutResponseSchema,
  type CheckoutResponseDto,
  type CheckoutVerifyRequest,
  checkoutVerifyResponseSchema,
  type CheckoutVerifyResponseDto,
  DEFAULT_MAX_QTY_PER_VARIANT,
  pincodeLookupResponseSchema,
  type PincodeLookupResponseDto,
  productListQuerySchema,
  type ProductListQuery,
  publicAvailabilityResponseSchema,
  type PublicAvailabilityResponseDto,
  publicProductListResponseSchema,
  type PublicProductListResponseDto,
  publicProductSchema,
  type PublicProductDto,
  publicSettingsResponseSchema,
  type PublicSettingsResponseDto,
} from '@pressedoils/shared'
import { getPublicApiBaseUrl, getServerApiBaseUrl } from './env'

export const WEB_CACHE_TAGS = {
  PRODUCTS: 'products',
  SETTINGS: 'settings',
  product: (slug: string) => `product:${slug}`,
} as const

const FETCH_TIMEOUT_MS = 5000

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

function buildProductsQueryString(query: ProductListQuery): string {
  const params = new URLSearchParams()
  if (query.inStockOnly !== undefined) params.set('inStockOnly', String(query.inStockOnly))
  if (query.size !== undefined) params.set('size', query.size)
  if (query.minPricePaise !== undefined) params.set('minPricePaise', String(query.minPricePaise))
  if (query.maxPricePaise !== undefined) params.set('maxPricePaise', String(query.maxPricePaise))
  params.set('sort', query.sort)
  params.set('page', String(query.page))
  params.set('pageSize', String(query.pageSize))
  return params.toString()
}

/**
 * Fetches active catalog products on the server with tag-based ISR + short timeout.
 * Intentionally throws on transport/API errors so Next.js ISR preserves the last
 * healthy cached page instead of caching an error screen.
 */
export async function fetchPublicProducts(
  query: Partial<ProductListQuery> = {},
): Promise<PublicProductListResponseDto> {
  const validated = productListQuerySchema.parse(query)
  const qs = buildProductsQueryString(validated)
  const url = `${getServerApiBaseUrl()}/products?${qs}`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: 30, tags: [WEB_CACHE_TAGS.PRODUCTS] },
  })

  if (!res.ok) {
    throw new ApiRequestError(`Failed to load products (${res.status})`, res.status, url)
  }

  const json: unknown = await res.json()
  return publicProductListResponseSchema.parse(json)
}

/**
 * Fetches a single product by slug on the server.
 * Returns null only for HTTP 404 so the page renders a true HTTP 404 via notFound().
 * Throws on any other error so ISR stale cache behavior stays intact.
 */
export async function fetchPublicProductBySlug(slug: string): Promise<PublicProductDto | null> {
  const safeSlug = encodeURIComponent(slug.trim())
  const url = `${getServerApiBaseUrl()}/products/${safeSlug}`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: {
      revalidate: 60,
      tags: [WEB_CACHE_TAGS.PRODUCTS, WEB_CACHE_TAGS.product(slug.trim())],
    },
  })

  if (res.status === 404) {
    return null
  }

  if (!res.ok) {
    throw new ApiRequestError(`Failed to load product "${slug}" (${res.status})`, res.status, url)
  }

  const json: unknown = await res.json()
  return publicProductSchema.parse(json)
}

/**
 * Fetches public storefront settings (brand name, shipping thresholds, legal details, limits).
 * Throws on failure so stale cached settings stay intact during transient API blips.
 */
export async function fetchPublicSettings(): Promise<PublicSettingsResponseDto> {
  const url = `${getServerApiBaseUrl()}/settings`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: 60, tags: [WEB_CACHE_TAGS.SETTINGS] },
  })

  if (!res.ok) {
    throw new ApiRequestError(`Failed to load settings (${res.status})`, res.status, url)
  }

  const json: unknown = await res.json()
  return publicSettingsResponseSchema.parse(json)
}

/**
 * Live availability fetch for client components (page load, window focus, post-add).
 * Uses `cache: 'no-store'` and respects the API's 50-UUID per-request limit.
 */
export async function fetchLiveAvailability(
  variantIds: readonly string[],
  signal?: AbortSignal,
): Promise<PublicAvailabilityResponseDto> {
  const uniqueIds = Array.from(new Set(variantIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) {
    return { items: [], maxOrderQtyPerVariant: DEFAULT_MAX_QTY_PER_VARIANT }
  }

  const chunks: string[][] = []
  for (let i = 0; i < uniqueIds.length; i += 50) {
    chunks.push(uniqueIds.slice(i, i + 50))
  }

  const responses = await Promise.all(
    chunks.map(async (chunk) => {
      const url = `${getPublicApiBaseUrl()}/products/availability?variantIds=${encodeURIComponent(
        chunk.join(','),
      )}`
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) {
        throw new ApiRequestError(`Failed to check availability (${res.status})`, res.status, url)
      }
      const json: unknown = await res.json()
      return publicAvailabilityResponseSchema.parse(json)
    }),
  )

  return {
    items: responses.flatMap((r) => r.items),
    maxOrderQtyPerVariant: responses[0]?.maxOrderQtyPerVariant ?? DEFAULT_MAX_QTY_PER_VARIANT,
  }
}

export async function lookupServiceablePincode(
  pincode: string,
  signal?: AbortSignal,
): Promise<PincodeLookupResponseDto> {
  const url = `${getPublicApiBaseUrl()}/pincode/${encodeURIComponent(pincode.trim())}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new ApiRequestError(`Failed to check pincode (${res.status})`, res.status, url)
  }
  const json: unknown = await res.json()
  return pincodeLookupResponseSchema.parse(json)
}

export async function validateCartOnServer(
  payload: CartValidateRequest,
  options: { sessionToken?: string; signal?: AbortSignal } = {},
): Promise<{ data: CartValidateResponseDto; nextSessionToken: string | null }> {
  const url = `${getPublicApiBaseUrl()}/cart/validate`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.sessionToken ? { 'X-Cart-Session': options.sessionToken } : {}),
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: options.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  const nextSessionToken = res.headers.get('x-cart-session')

  if (!res.ok) {
    let message = `Unable to validate bag (${res.status})`
    try {
      const errBody = (await res.json()) as { message?: string }
      if (typeof errBody?.message === 'string' && errBody.message.trim()) {
        message = errBody.message
      }
    } catch {
      // Fall back to generic status message
    }
    throw new ApiRequestError(message, res.status, url)
  }

  const json: unknown = await res.json()
  return {
    data: cartValidateResponseSchema.parse(json),
    nextSessionToken,
  }
}

async function readApiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const errBody = (await res.json()) as { message?: string }
    if (typeof errBody?.message === 'string' && errBody.message.trim()) {
      return errBody.message
    }
  } catch {
    // Ignore parse error and fall back to status text
  }
  return fallback
}

export async function createCheckoutOrder(
  payload: CheckoutRequest,
  options: { idempotencyKey: string; sessionToken?: string; signal?: AbortSignal },
): Promise<{ data: CheckoutResponseDto; nextSessionToken: string | null }> {
  const url = `${getPublicApiBaseUrl()}/checkout`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': options.idempotencyKey,
      ...(options.sessionToken ? { 'X-Cart-Session': options.sessionToken } : {}),
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: options.signal ?? AbortSignal.timeout(15_000),
  })

  const nextSessionToken = res.headers.get('x-cart-session')
  if (!res.ok) {
    throw new ApiRequestError(
      await readApiErrorMessage(res, `Checkout could not be completed (${res.status})`),
      res.status,
      url,
    )
  }

  const json: unknown = await res.json()
  return {
    data: checkoutResponseSchema.parse(json),
    nextSessionToken,
  }
}

export async function verifyCheckoutPayment(
  payload: CheckoutVerifyRequest,
  signal?: AbortSignal,
): Promise<CheckoutVerifyResponseDto> {
  const url = `${getPublicApiBaseUrl()}/checkout/verify`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new ApiRequestError(
      await readApiErrorMessage(res, `Payment verification failed (${res.status})`),
      res.status,
      url,
    )
  }
  const json: unknown = await res.json()
  return checkoutVerifyResponseSchema.parse(json)
}

export async function failCheckoutPayment(
  payload: CheckoutFailRequest,
  signal?: AbortSignal,
): Promise<CheckoutFailResponseDto> {
  const url = `${getPublicApiBaseUrl()}/checkout/fail`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    throw new ApiRequestError(
      await readApiErrorMessage(res, `Unable to cancel payment session (${res.status})`),
      res.status,
      url,
    )
  }
  const json: unknown = await res.json()
  return checkoutFailResponseSchema.parse(json)
}

export async function mockCompleteCheckoutPayment(
  orderId: string,
  signal?: AbortSignal,
): Promise<CheckoutVerifyResponseDto> {
  const url = `${getPublicApiBaseUrl()}/checkout/mock-complete`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ orderId }),
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new ApiRequestError(
      await readApiErrorMessage(res, `Mock payment failed (${res.status})`),
      res.status,
      url,
    )
  }
  const json: unknown = await res.json()
  return checkoutVerifyResponseSchema.parse(json)
}
