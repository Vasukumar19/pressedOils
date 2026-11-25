import type { Metadata } from 'next'
import { productListQuerySchema, type ProductListQuery } from '@pressedoils/shared'
import { CartDrawer } from '@/components/oil/cart-drawer'
import { Footer } from '@/components/oil/closing-footer'
import { Navbar } from '@/components/oil/navbar'
import { ShopCatalog } from '@/components/oil/shop-catalog'
import { fetchPublicProducts, fetchPublicSettings } from '@/lib/api'
import { CartProvider } from '@/lib/cart'

export const revalidate = 30

export const metadata: Metadata = {
  title: 'Shop Cold-Pressed Oils',
  description:
    'Browse cold-pressed groundnut, white sesame, black sesame, sunflower, safflower, and coconut oils with pressing dates and live stock status.',
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseShopQuery(
  rawSearchParams: Record<string, string | string[] | undefined>,
): ProductListQuery {
  const candidate = {
    inStockOnly: firstParam(rawSearchParams.inStockOnly),
    size: firstParam(rawSearchParams.size),
    minPricePaise: firstParam(rawSearchParams.minPricePaise),
    maxPricePaise: firstParam(rawSearchParams.maxPricePaise),
    sort: firstParam(rawSearchParams.sort),
    page: firstParam(rawSearchParams.page),
    pageSize: firstParam(rawSearchParams.pageSize),
  }

  const cleaned = Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined && value !== ''),
  )

  const parsed = productListQuerySchema.safeParse(cleaned)
  if (parsed.success) {
    return parsed.data
  }

  return productListQuerySchema.parse({})
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = await searchParams
  const query = parseShopQuery(resolvedSearchParams)

  const [data, settings] = await Promise.all([fetchPublicProducts(query), fetchPublicSettings()])

  return (
    <CartProvider initialProducts={data.items} initialSettings={settings}>
      <Navbar
        brandName={settings.brandName}
        freeShippingThresholdPaise={settings.freeShippingThresholdPaise}
      />
      <main className="bg-ivory text-ink min-h-[100svh] pt-36 pb-24 md:pt-44">
        <ShopCatalog data={data} query={query} />
      </main>
      <Footer settings={settings} />
      <CartDrawer />
    </CartProvider>
  )
}
