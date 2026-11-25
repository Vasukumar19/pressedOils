import type { PublicProductDto } from '@pressedoils/shared'
import { describe, expect, it } from 'vitest'
import { buildProductJsonLd } from './json-ld'

const SAMPLE_PRODUCT: PublicProductDto = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  slug: 'white-sesame-oil',
  name: 'White Sesame Oil',
  description: 'Cold-pressed white sesame oil.',
  bestFor: 'Tempering and light cooking',
  originRegion: 'Erode',
  sortOrder: 2,
  brand: '[YOUR BRAND]',
  images: [
    {
      id: '550e8400-e29b-41d4-a716-446655440011',
      url: 'https://cdn.example.com/products/white-sesame.webp',
      alt: 'White sesame oil',
      sortOrder: 0,
    },
  ],
  variants: [
    {
      id: '550e8400-e29b-41d4-a716-446655440012',
      sku: 'WSES-500ML',
      sizeLabel: '500 ml',
      pricePaise: 32000,
      mrpPaise: 35000,
      inStock: true,
      lowStock: false,
    },
  ],
  currentBatch: {
    batchNo: 'WSES-01',
    pressedOn: '2026-02-01',
    pressedOnDisplay: '01 Feb 2026',
    bestBefore: '2026-11-01',
    bestBeforeDisplay: '01 Nov 2026',
    labReportUrl: null,
    labTestedOn: null,
    labTestedOnDisplay: null,
  },
}

describe('buildProductJsonLd', () => {
  it('omits Third-Party Lab Tested claim in production when no trusted lab report exists', () => {
    const jsonLd = buildProductJsonLd(SAMPLE_PRODUCT, {
      isProduction: true,
      allowedReportDomains: ['cdn.example.com'],
    })

    expect(jsonLd['@type']).toBe('Product')
    expect(jsonLd.offers[0]).toMatchObject({
      priceCurrency: 'INR',
      price: '320.00',
      availability: 'https://schema.org/InStock',
    })
    expect(jsonLd.additionalProperty.some((p) => p.name === 'Third-Party Lab Tested')).toBe(false)
  })

  it('includes Third-Party Lab Tested property only when trusted CDN report URL is present', () => {
    const jsonLd = buildProductJsonLd(
      {
        ...SAMPLE_PRODUCT,
        currentBatch: {
          ...SAMPLE_PRODUCT.currentBatch!,
          labReportUrl: 'https://cdn.example.com/reports/wses-01.pdf',
          labTestedOn: '2026-02-03',
          labTestedOnDisplay: '03 Feb 2026',
        },
      },
      {
        isProduction: true,
        allowedReportDomains: ['cdn.example.com'],
      },
    )

    expect(jsonLd.additionalProperty.find((p) => p.name === 'Third-Party Lab Tested')?.value).toBe(
      '03 Feb 2026',
    )
  })
})
