import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { SingleFlight, withJitter } from '../common/single-flight'
import { RedisService } from '../redis/redis.service'

const CATALOG_VERSION_KEY = 'catalog:version'
const CATALOG_VERSION_TTL_SECONDS = 86_400
const CATALOG_TTL_SECONDS = 300
const AVAILABILITY_TTL_SECONDS = 3

function generateVersionToken(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`
}

/**
 * Separates long-lived catalog caching (descriptions, images, prices, batch info: ~5 min + jitter)
 * from ultra-short availability caching (stock/reserved check: ~3s + jitter),
 * both protected by SingleFlight stampede deduplication.
 */
@Injectable()
export class ProductCacheService {
  readonly singleFlight = new SingleFlight()

  constructor(private readonly redis: RedisService) {}

  async getCatalogVersion(): Promise<string> {
    const version = await this.redis.getString(CATALOG_VERSION_KEY)
    if (version) return version

    const initial = generateVersionToken()
    await this.redis.setStringNx(CATALOG_VERSION_KEY, initial, CATALOG_VERSION_TTL_SECONDS)
    return (await this.redis.getString(CATALOG_VERSION_KEY)) ?? initial
  }

  async getOrLoadCatalog<T>(cacheKeySuffix: string, loader: () => Promise<T>): Promise<T> {
    const version = await this.getCatalogVersion()
    const key = `catalog:v${version}:${cacheKeySuffix}`

    const cached = await this.redis.getJson<T>(key)
    if (cached !== null) return cached

    return this.singleFlight.run(key, async () => {
      const doubleCheck = await this.redis.getJson<T>(key)
      if (doubleCheck !== null) return doubleCheck

      const fresh = await loader()
      await this.redis.setJson(key, fresh, withJitter(CATALOG_TTL_SECONDS, 0.2))
      return fresh
    })
  }

  async getOrLoadAvailability<T>(variantIdsKey: string, loader: () => Promise<T>): Promise<T> {
    const key = `avail:v1:${variantIdsKey}`
    const cached = await this.redis.getJson<T>(key)
    if (cached !== null) return cached

    return this.singleFlight.run(key, async () => {
      const fresh = await loader()
      await this.redis.setJson(key, fresh, withJitter(AVAILABILITY_TTL_SECONDS, 0.2))
      return fresh
    })
  }

  /** Invalidates all cached catalog lists and optional product detail & availability keys. */
  async invalidateProductCache(slug?: string, variantIds: string[] = []): Promise<void> {
    await this.redis.setString(
      CATALOG_VERSION_KEY,
      generateVersionToken(),
      CATALOG_VERSION_TTL_SECONDS,
    )
    const keysToDelete: string[] = []
    if (slug) keysToDelete.push(`catalog:detail:${slug}`)
    for (const id of variantIds) keysToDelete.push(`avail:v1:${id}`)
    await this.redis.del(...keysToDelete)
  }
}
