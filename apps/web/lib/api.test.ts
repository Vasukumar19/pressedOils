import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiRequestError,
  fetchLiveAvailability,
  fetchPublicProductBySlug,
  fetchPublicProducts,
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
})
