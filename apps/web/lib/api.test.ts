import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiRequestError,
  fetchLiveAvailability,
  fetchPublicProductBySlug,
  fetchPublicProducts,
  validateCartOnServer,
} from './api'

describe('storefront API client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws ApiRequestError on HTTP 500 rather than swallowing errors so ISR preserves stale cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ message: 'DB error' }), { status: 500 })),
    )

    await expect(fetchPublicProducts({ page: 1, pageSize: 6 })).rejects.toBeInstanceOf(
      ApiRequestError,
    )
    await expect(fetchPublicProductBySlug('groundnut-oil')).rejects.toBeInstanceOf(ApiRequestError)
  })

  it('returns null on HTTP 404 for product detail so Next.js renders notFound()', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ message: 'Not found' }), { status: 404 })),
    )

    await expect(fetchPublicProductBySlug('does-not-exist')).resolves.toBeNull()
  })

  it('fetches live availability with no-store and handles empty input without network calls', async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              variantId: '550e8400-e29b-41d4-a716-446655440001',
              inStock: true,
              lowStock: true,
              availableStock: 3,
            },
          ],
          maxOrderQtyPerVariant: 10,
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', spy)

    const empty = await fetchLiveAvailability([])
    expect(empty.items).toEqual([])
    expect(spy).not.toHaveBeenCalled()

    const live = await fetchLiveAvailability(['550e8400-e29b-41d4-a716-446655440001'])
    expect(live.items[0]?.availableStock).toBe(3)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/products/availability?variantIds='),
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('validates cart on server, forwards X-Cart-Session token, and surfaces API error messages', async () => {
    const validResponse = {
      items: [],
      fulfilmentMethod: 'DELIVERY',
      pickup: null,
      pincode: null,
      coupon: null,
      freeShipping: null,
      tax: { showTaxBreakdown: false },
      summary: {
        itemsSubtotalPaise: 0,
        discountPaise: 0,
        netItemsTotalPaise: 0,
        shippingPaise: null,
        shippingStatus: 'ENTER_PINCODE',
        taxAddedPaise: 0,
        totalPaise: 0,
        totalLabel: 'Items total',
        canCheckout: false,
      },
      maxOrderQtyPerVariant: 10,
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validResponse), {
          status: 200,
          headers: { 'x-cart-session': 'sess-123.sig' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: 'Too many invalid coupon attempts. Please try again later.' }),
          { status: 429 },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const ok = await validateCartOnServer(
      { items: [], fulfilmentMethod: 'DELIVERY' },
      { sessionToken: 'prev.tok' },
    )
    expect(ok.nextSessionToken).toBe('sess-123.sig')
    expect(ok.data.summary.totalLabel).toBe('Items total')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/cart/validate'),
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: expect.objectContaining({ 'X-Cart-Session': 'prev.tok' }),
      }),
    )

    await expect(validateCartOnServer({ items: [], fulfilmentMethod: 'DELIVERY' })).rejects.toThrow(
      /Too many invalid coupon attempts/,
    )
  })
})
