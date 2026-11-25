import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  isPlaceholderUrl,
  isProductionRuntime,
  type ProductListQuery,
  type PublicAvailabilityResponseDto,
  type PublicProductDto,
  type PublicProductListResponseDto,
} from '@pressedoils/shared'
import { env } from '../env'
import { PrismaService } from '../prisma/prisma.service'
import { ProductCacheService } from './products.cache'
import {
  type CachedCatalogProduct,
  mapCatalogProduct,
  mapPublicProduct,
  mapVariantAvailability,
  type VariantAvailabilityRecord,
} from './products.mapper'

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ProductCacheService,
  ) {}

  private isProdRuntime(): boolean {
    return isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })
  }

  private filterPlaceholderProducts(products: CachedCatalogProduct[]): CachedCatalogProduct[] {
    if (!this.isProdRuntime()) return products

    return products.filter((product) => {
      const hasPlaceholder = product.images.some((img) => isPlaceholderUrl(img.url))
      if (hasPlaceholder) {
        this.logger.error({
          alert: 'PLACEHOLDER_PRODUCT_IN_PROD',
          slug: product.slug,
          productId: product.id,
          message: 'Excluded active product referencing /placeholders/ in production',
        })
        return false
      }
      return true
    })
  }

  private async loadAllActiveCatalog(): Promise<CachedCatalogProduct[]> {
    return this.cache.getOrLoadCatalog('all-active', async () => {
      const rows = await this.prisma.product.findMany({
        where: { is_active: true },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          best_for: true,
          origin_region: true,
          sort_order: true,
          brand: true,
          created_at: true,
          images: {
            orderBy: { sort_order: 'asc' },
            select: { id: true, url: true, alt: true, sort_order: true },
          },
          variants: {
            where: { is_active: true },
            orderBy: { price_paise: 'asc' },
            select: {
              id: true,
              sku: true,
              size_label: true,
              price_paise: true,
              mrp_paise: true,
            },
          },
          batches: {
            where: { is_active: true, is_current: true },
            take: 1,
            select: {
              batch_no: true,
              pressed_on: true,
              best_before: true,
              lab_report_url: true,
              lab_tested_on: true,
            },
          },
        },
      })

      return rows.map(mapCatalogProduct)
    })
  }

  private async loadVariantAvailability(
    variantIds: string[],
    options: { bypassCache?: boolean } = {},
  ): Promise<Map<string, VariantAvailabilityRecord>> {
    if (variantIds.length === 0) return new Map()

    const sortedIds = [...new Set(variantIds)].sort()
    const key = sortedIds.join(',')

    const fetchRows = async () =>
      this.prisma.variant.findMany({
        where: { id: { in: sortedIds }, is_active: true },
        select: {
          id: true,
          stock: true,
          reserved: true,
          low_stock_threshold: true,
        },
      })

    const rows = options.bypassCache
      ? await fetchRows()
      : await this.cache.getOrLoadAvailability(key, fetchRows)

    return new Map(rows.map((r) => [r.id, r]))
  }

  async list(query: ProductListQuery): Promise<PublicProductListResponseDto> {
    const rawCatalog = await this.loadAllActiveCatalog()
    const catalog = this.filterPlaceholderProducts(rawCatalog)

    const allVariantIds = catalog.flatMap((p) => p.variants.map((v) => v.id))
    const availabilityMap = await this.loadVariantAvailability(allVariantIds)

    let mapped = catalog.map((item) => mapPublicProduct(item, availabilityMap))

    // Filter by size
    if (query.size) {
      mapped = mapped.filter((p) => p.variants.some((v) => v.sizeLabel === query.size))
    }

    // Filter by price range (against any active variant matching optional size)
    if (query.minPricePaise !== undefined || query.maxPricePaise !== undefined) {
      mapped = mapped.filter((p) =>
        p.variants.some((v) => {
          if (query.size && v.sizeLabel !== query.size) return false
          if (query.minPricePaise !== undefined && v.pricePaise < query.minPricePaise) return false
          if (query.maxPricePaise !== undefined && v.pricePaise > query.maxPricePaise) return false
          return true
        }),
      )
    }

    // Filter by availability
    if (query.inStockOnly) {
      mapped = mapped.filter((p) => p.variants.some((v) => v.inStock))
    }

    // Sort
    const createdAtBySlug = new Map(catalog.map((c) => [c.slug, c.createdAtIso]))
    const minPrice = (p: PublicProductDto) =>
      p.variants.length > 0 ? Math.min(...p.variants.map((v) => v.pricePaise)) : 0

    if (query.sort === 'price_asc') {
      mapped.sort((a, b) => minPrice(a) - minPrice(b))
    } else if (query.sort === 'price_desc') {
      mapped.sort((a, b) => minPrice(b) - minPrice(a))
    } else if (query.sort === 'newest') {
      mapped.sort((a, b) =>
        (createdAtBySlug.get(b.slug) ?? '').localeCompare(createdAtBySlug.get(a.slug) ?? ''),
      )
    } else {
      mapped.sort((a, b) => a.sortOrder - b.sortOrder)
    }

    // Paginate
    const total = mapped.length
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize)
    const offset = (query.page - 1) * query.pageSize
    const items = mapped.slice(offset, offset + query.pageSize)

    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
      },
    }
  }

  async getBySlug(slug: string): Promise<PublicProductDto> {
    const rawCatalog = await this.loadAllActiveCatalog()
    const filtered = this.filterPlaceholderProducts(rawCatalog)
    const product = filtered.find((p) => p.slug === slug)

    if (!product) {
      throw new NotFoundException(`Product "${slug}" not found`)
    }

    const availabilityMap = await this.loadVariantAvailability(product.variants.map((v) => v.id))
    return mapPublicProduct(product, availabilityMap)
  }

  async getAvailability(variantIds: string[]): Promise<PublicAvailabilityResponseDto> {
    const availabilityMap = await this.loadVariantAvailability(variantIds, { bypassCache: true })
    const items = [...new Set(variantIds)]
      .map((id) => availabilityMap.get(id))
      .filter((row): row is VariantAvailabilityRecord => row !== undefined)
      .map(mapVariantAvailability)

    return {
      items,
      maxOrderQtyPerVariant: env.MAX_QTY_PER_VARIANT,
    }
  }
}
