import { describe, expect, it } from 'vitest'
import { parseTrustProxy, validateEnv } from '../src/env'

describe('validateEnv', () => {
  it('allows test mode without DATABASE_URL or REDIS_URL', () => {
    const parsed = validateEnv({ NODE_ENV: 'test' })
    expect(parsed.NODE_ENV).toBe('test')
    expect(parsed.PORT).toBe(4000)
    expect(parsed.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001'])
  })

  it('requires DATABASE_URL and REDIS_URL in development and production', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow()
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow()
  })

  it('rejects wildcard "*" in CORS_ORIGINS', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'test',
        CORS_ORIGINS: '*',
      }),
    ).toThrow()
  })

  it('requires staging swagger auth or IP allowlist when APP_ENV=staging', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
        REDIS_URL: 'redis://redis.internal:6379',
      }),
    ).toThrow()

    const valid = validateEnv({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
      REDIS_URL: 'redis://redis.internal:6379',
      SWAGGER_USER: 'reviewer',
      SWAGGER_PASSWORD: 'super-secret-staging-pw',
    })
    expect(valid.APP_ENV).toBe('staging')
  })

  it('parses TRUST_PROXY safely without blind unlimited trust', () => {
    expect(parseTrustProxy('false')).toBe(false)
    expect(parseTrustProxy('true')).toBe(1)
    expect(parseTrustProxy('2')).toBe(2)
    expect(parseTrustProxy('loopback')).toBe('loopback')
  })
})
