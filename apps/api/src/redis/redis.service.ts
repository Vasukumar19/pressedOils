import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import Redis from 'ioredis'
import { CircuitBreaker } from '../common/circuit-breaker'
import { env } from '../env'

const INCR_WITH_TTL_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
else
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
end
return { current, redis.call('PTTL', KEYS[1]) }
`

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  private client: Redis | null = null
  readonly breaker: CircuitBreaker

  constructor() {
    this.breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 15_000,
      onStateChange: (from, to, reason) => {
        if (to === 'OPEN') {
          this.logger.error({
            alert: 'REDIS_DEGRADED',
            circuitFrom: from,
            circuitTo: to,
            reason: reason ?? 'Redis command failures exceeded threshold',
          })
        } else if (to === 'CLOSED') {
          this.logger.log({
            event: 'REDIS_RECOVERED',
            circuitFrom: from,
            circuitTo: to,
          })
        }
      },
    })

    if (env.REDIS_URL) {
      this.client = new Redis(env.REDIS_URL, {
        commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS,
        connectTimeout: 500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy: (times) => Math.min(times * 250, 2000),
      })

      this.client.on('error', (err) => {
        this.logger.warn({ event: 'REDIS_CLIENT_ERROR', message: err.message })
      })
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) return
    try {
      await this.client.connect()
      await this.client.ping()
      this.breaker.recordSuccess()
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'connect failed')
      this.logger.error({
        alert: 'REDIS_DEGRADED',
        message: 'Initial Redis connect failed; failing open to PostgreSQL',
      })
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return
    try {
      await this.client.quit()
    } catch {
      this.client.disconnect()
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.client || !this.breaker.isExecutionAllowed()) return null
    try {
      const raw = await this.client.get(key)
      this.breaker.recordSuccess()
      if (!raw) return null
      return JSON.parse(raw) as T
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'getJson failed')
      return null
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client || !this.breaker.isExecutionAllowed()) return
    const safeTtl = Math.max(1, Math.round(ttlSeconds))
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', safeTtl)
      this.breaker.recordSuccess()
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'setJson failed')
    }
  }

  async getString(key: string): Promise<string | null> {
    if (!this.client || !this.breaker.isExecutionAllowed()) return null
    try {
      const val = await this.client.get(key)
      this.breaker.recordSuccess()
      return val
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'getString failed')
      return null
    }
  }

  async setString(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.client || !this.breaker.isExecutionAllowed()) return
    const safeTtl = Math.max(1, Math.round(ttlSeconds))
    try {
      await this.client.set(key, value, 'EX', safeTtl)
      this.breaker.recordSuccess()
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'setString failed')
    }
  }

  async setStringNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client || !this.breaker.isExecutionAllowed()) return false
    const safeTtl = Math.max(1, Math.round(ttlSeconds))
    try {
      const res = await this.client.set(key, value, 'EX', safeTtl, 'NX')
      this.breaker.recordSuccess()
      return res === 'OK'
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'setStringNx failed')
      return false
    }
  }

  async incrKey(key: string, ttlSeconds: number): Promise<number | null> {
    if (!this.client || !this.breaker.isExecutionAllowed()) return null
    try {
      const next = await this.client.incr(key)
      await this.client.expire(key, Math.max(1, Math.round(ttlSeconds)))
      this.breaker.recordSuccess()
      return next
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'incrKey failed')
      return null
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0 || !this.client || !this.breaker.isExecutionAllowed()) return
    try {
      await this.client.del(...keys)
      this.breaker.recordSuccess()
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'del failed')
    }
  }

  /** Atomic rate-limit increment ensuring every key always carries a TTL. */
  async incrRateLimit(key: string, ttlMs: number): Promise<{ hits: number; ttlMs: number } | null> {
    if (!this.client || !this.breaker.isExecutionAllowed()) return null
    try {
      const res = (await this.client.eval(INCR_WITH_TTL_LUA, 1, key, String(ttlMs))) as [
        number,
        number,
      ]
      this.breaker.recordSuccess()
      return {
        hits: Number(res[0]),
        ttlMs: Math.max(1, Number(res[1])),
      }
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'incrRateLimit failed')
      return null
    }
  }

  async ping(): Promise<'ok' | 'degraded'> {
    if (!this.client) return 'degraded'
    if (this.breaker.getState() === 'OPEN') return 'degraded'
    try {
      const pong = await this.client.ping()
      if (pong === 'PONG') {
        this.breaker.recordSuccess()
        return 'ok'
      }
      this.breaker.recordFailure('unexpected ping reply')
      return 'degraded'
    } catch (err) {
      this.breaker.recordFailure(err instanceof Error ? err.message : 'ping failed')
      return 'degraded'
    }
  }
}
