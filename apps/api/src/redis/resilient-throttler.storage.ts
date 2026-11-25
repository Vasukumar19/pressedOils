import { Injectable } from '@nestjs/common'
import type { ThrottlerStorage } from '@nestjs/throttler'
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface'
import { RedisService } from './redis.service'

interface MemoryBucket {
  hits: number
  expiresAt: number
  blockExpiresAt: number
}

/**
 * Redis-backed ThrottlerStorage with automatic in-memory fallback when Redis
 * is down or the circuit breaker is open — rate limiting never turns off.
 */
@Injectable()
export class ResilientThrottlerStorage implements ThrottlerStorage {
  private readonly fallbackBuckets = new Map<string, MemoryBucket>()

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `rl:${throttlerName}:${key}`
    const res = await this.redis.incrRateLimit(redisKey, ttl)

    if (res !== null) {
      const isBlocked = res.hits > limit && blockDuration > 0
      return {
        totalHits: res.hits,
        timeToExpire: Math.ceil(res.ttlMs / 1000),
        isBlocked,
        timeToBlockExpire: isBlocked ? Math.ceil(blockDuration / 1000) : 0,
      }
    }

    return this.incrementInMemory(redisKey, ttl, limit, blockDuration)
  }

  async getCurrentHits(key: string, throttlerName: string): Promise<number> {
    const redisKey = `rl:${throttlerName}:${key}`
    const val = await this.redis.getString(redisKey)
    if (val !== null) {
      const parsed = Number(val)
      return Number.isFinite(parsed) ? parsed : 0
    }
    const existing = this.fallbackBuckets.get(redisKey)
    if (!existing || existing.expiresAt <= Date.now()) return 0
    return existing.hits
  }

  private incrementInMemory(
    key: string,
    ttlMs: number,
    limit: number,
    blockDuration: number,
  ): ThrottlerStorageRecord {
    const now = Date.now()
    if (this.fallbackBuckets.size > 5000) {
      this.pruneExpired(now)
    }

    const existing = this.fallbackBuckets.get(key)
    if (!existing || existing.expiresAt <= now) {
      const entry: MemoryBucket = {
        hits: 1,
        expiresAt: now + ttlMs,
        blockExpiresAt: 0,
      }
      this.fallbackBuckets.set(key, entry)
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttlMs / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      }
    }

    existing.hits += 1
    const isBlocked = existing.hits > limit && blockDuration > 0
    if (isBlocked && existing.blockExpiresAt <= now) {
      existing.blockExpiresAt = now + blockDuration
    }

    return {
      totalHits: existing.hits,
      timeToExpire: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
      isBlocked,
      timeToBlockExpire:
        existing.blockExpiresAt > now ? Math.ceil((existing.blockExpiresAt - now) / 1000) : 0,
    }
  }

  private pruneExpired(now: number): void {
    for (const [k, v] of this.fallbackBuckets.entries()) {
      if (v.expiresAt <= now && v.blockExpiresAt <= now) {
        this.fallbackBuckets.delete(k)
      }
    }
  }
}
