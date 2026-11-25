import { describe, expect, it } from 'vitest'
import { validateEnv } from '../src/env'

describe('validateEnv', () => {
  it('allows test mode without DATABASE_URL or REDIS_URL', () => {
    const parsed = validateEnv({ NODE_ENV: 'test' })
    expect(parsed.NODE_ENV).toBe('test')
    expect(parsed.PORT).toBe(4000)
  })

  it('requires DATABASE_URL and REDIS_URL in development and production', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow()
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow()
  })

  it('validates complete development and production configurations', () => {
    const parsed = validateEnv({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      IS_PRODUCTION_DB: 'true',
      PORT: '4000',
      DATABASE_URL: 'postgresql://user:pass@db.internal:5432/pressedoils',
      REDIS_URL: 'redis://redis.internal:6379',
    })
    expect(parsed.APP_ENV).toBe('production')
    expect(parsed.IS_PRODUCTION_DB).toBe('true')
  })
})
