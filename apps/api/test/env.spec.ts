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
      CART_SESSION_SECRET: 'staging-cart-session-secret-1234',
    })
    expect(valid.APP_ENV).toBe('staging')
  })

  it('parses TRUST_PROXY safely without blind unlimited trust', () => {
    expect(parseTrustProxy('false')).toBe(false)
    expect(parseTrustProxy('true')).toBe(1)
    expect(parseTrustProxy('2')).toBe(2)
    expect(parseTrustProxy('loopback')).toBe('loopback')
  })

  it('fails boot if mock payment gateway or ALLOW_MOCK_GATEWAY is enabled when APP_ENV=production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
        REDIS_URL: 'redis://redis.internal:6379',
        CART_SESSION_SECRET: 'prod-cart-session-secret-1234',
        PICKUP_CODE_HMAC_SECRET: 'prod-pickup-hmac-secret-123456',
        PAYMENT_GATEWAY: 'mock',
      }),
    ).toThrow()

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
        REDIS_URL: 'redis://redis.internal:6379',
        CART_SESSION_SECRET: 'prod-cart-session-secret-1234',
        PICKUP_CODE_HMAC_SECRET: 'prod-pickup-hmac-secret-123456',
        PAYMENT_GATEWAY: 'razorpay',
        ALLOW_MOCK_GATEWAY: 'true',
        RAZORPAY_KEY_ID: 'rzp_live_123',
        RAZORPAY_KEY_SECRET: 'rzp_secret_123',
      }),
    ).toThrow()

    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
        REDIS_URL: 'redis://redis.internal:6379',
        CART_SESSION_SECRET: 'prod-cart-session-secret-1234',
        PAYMENT_GATEWAY: 'razorpay',
        RAZORPAY_KEY_ID: 'rzp_live_123',
        RAZORPAY_KEY_SECRET: 'rzp_secret_123',
      }),
    ).toThrow()

    const validProd = validateEnv({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
      REDIS_URL: 'redis://redis.internal:6379',
      CART_SESSION_SECRET: 'prod-cart-session-secret-1234',
      PICKUP_CODE_HMAC_SECRET: 'prod-pickup-hmac-secret-123456',
      PAYMENT_GATEWAY: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_live_123',
      RAZORPAY_KEY_SECRET: 'rzp_secret_123',
    })
    expect(validProd.PAYMENT_GATEWAY).toBe('razorpay')
  })
})
