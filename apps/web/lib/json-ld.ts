import { isTrustedLabReportUrl, type PublicProductDto } from '@pressedoils/shared'

export interface ProductJsonLdOptions {
  siteUrl?: string
  isProduction: boolean
  allowedReportDomains: readonly string[]
}

export function buildProductJsonLd(product: PublicProductDto, options: ProductJsonLdOptions) {
  const baseUrl = options.siteUrl?.replace(/\/+$/, '')
  const productUrl = baseUrl ? `${baseUrl}/products/${product.slug}` : `/products/${product.slug}`

  const images = product.images.map((img) => {
    if (img.url.startsWith('http://') || img.url.startsWith('https://') || !baseUrl) {
      return img.url
    }
    return `${baseUrl}${img.url.startsWith('/') ? img.url : `/${img.url}`}`
  })

  const hasVerifiedReport = isTrustedLabReportUrl(
    product.currentBatch?.labReportUrl,
    options.allowedReportDomains,
  )

  const additionalProperty: Array<{ '@type': 'PropertyValue'; name: string; value: string }> = [
    { '@type': 'PropertyValue', name: 'Origin Region', value: product.originRegion },
    { '@type': 'PropertyValue', name: 'Best For', value: product.bestFor },
  ]

  if (product.currentBatch) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'Current Batch',
      value: product.currentBatch.batchNo,
    })
    if (hasVerifiedReport && (!options.isProduction || product.currentBatch.labReportUrl)) {
      additionalProperty.push({
        '@type': 'PropertyValue',
        name: 'Third-Party Lab Tested',
        value: product.currentBatch.labTestedOnDisplay ?? 'Verified',
      })
    }
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: images,
    sku: product.variants[0]?.sku ?? product.slug.toUpperCase(),
    url: productUrl,
    brand: {
      '@type': 'Brand',
      name: product.brand,
    },
    category: 'Cold-Pressed Cooking Oils',
    offers: product.variants.map((variant) => ({
      '@type': 'Offer',
      sku: variant.sku,
      name: `${product.name} — ${variant.sizeLabel}`,
      priceCurrency: 'INR',
      price: (variant.pricePaise / 100).toFixed(2),
      availability: variant.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      url: productUrl,
    })),
    additionalProperty,
  }
}
