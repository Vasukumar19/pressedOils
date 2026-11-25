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
      QUEUE_REDIS_URL: 'redis://redis-queue.internal:6380',
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

    // Missing RAZORPAY_WEBHOOK_SECRET fails production boot
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
        REDIS_URL: 'redis://redis.internal:6379',
        QUEUE_REDIS_URL: 'redis://redis-queue.internal:6380',
        CART_SESSION_SECRET: 'prod-cart-session-secret-1234',
        PICKUP_CODE_HMAC_SECRET: 'prod-pickup-hmac-secret-123456',
        PAYMENT_GATEWAY: 'razorpay',
        RAZORPAY_KEY_ID: 'rzp_live_123',
        RAZORPAY_KEY_SECRET: 'rzp_secret_123',
      }),
    ).toThrow()

    // Missing QUEUE_REDIS_URL fails production boot
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
        REDIS_URL: 'redis://redis.internal:6379',
        CART_SESSION_SECRET: 'prod-cart-session-secret-1234',
        PICKUP_CODE_HMAC_SECRET: 'prod-pickup-hmac-secret-123456',
        PAYMENT_GATEWAY: 'razorpay',
        RAZORPAY_KEY_ID: 'rzp_live_123',
        RAZORPAY_KEY_SECRET: 'rzp_secret_123',
        RAZORPAY_WEBHOOK_SECRET: 'whsec_live_123',
      }),
    ).toThrow()

    // ENABLE_TEMP_ADMIN_API=true fails production boot
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
        REDIS_URL: 'redis://redis.internal:6379',
        QUEUE_REDIS_URL: 'redis://redis-queue.internal:6380',
        CART_SESSION_SECRET: 'prod-cart-session-secret-1234',
        PICKUP_CODE_HMAC_SECRET: 'prod-pickup-hmac-secret-123456',
        PAYMENT_GATEWAY: 'razorpay',
        RAZORPAY_KEY_ID: 'rzp_live_123',
        RAZORPAY_KEY_SECRET: 'rzp_secret_123',
        RAZORPAY_WEBHOOK_SECRET: 'whsec_live_123',
        ENABLE_TEMP_ADMIN_API: 'true',
      }),
    ).toThrow()

    const FULL_PROD_BASE_ENV = {
      NODE_ENV: 'production',
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db.internal:5432/app',
      REDIS_URL: 'redis://redis.internal:6379',
      QUEUE_REDIS_URL: 'redis://redis-queue.internal:6380',
      CART_SESSION_SECRET: 'prod-cart-session-secret-1234',
      PICKUP_CODE_HMAC_SECRET: 'prod-pickup-hmac-secret-123456',
      OTP_HMAC_SECRET: 'prod-otp-hmac-secret-1234567890',
      PAYMENT_GATEWAY: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_live_123',
      RAZORPAY_KEY_SECRET: 'rzp_secret_123',
      RAZORPAY_WEBHOOK_SECRET: 'whsec_live_123',
      SMS_PROVIDER: 'msg91',
      EMAIL_PROVIDER: 'resend',
      MSG91_AUTH_KEY: 'msg91-live-auth-key',
      MSG91_SENDER_ID: 'PRSOIL',
      MSG91_DLT_TEMPLATE_OTP: 'dlt-otp-1',
      MSG91_DLT_TEMPLATE_ORDER_CONFIRMED: 'dlt-conf-2',
      MSG91_DLT_TEMPLATE_ORDER_SHIPPED: 'dlt-ship-3',
      MSG91_DLT_TEMPLATE_ORDER_DELIVERED: 'dlt-deliv-4',
      MSG91_DLT_TEMPLATE_ORDER_READY_FOR_PICKUP: 'dlt-ready-5',
      MSG91_DLT_TEMPLATE_PICKUP_CODE: 'dlt-pick-6',
      MSG91_DLT_TEMPLATE_OWNER_ALERT: 'dlt-alert-7',
      MSG91_DLT_TEMPLATE_ORDER_UPDATE: 'dlt-upd-8',
      RESEND_API_KEY: 're_live_123',
      EMAIL_FROM: 'Orders <orders@example.com>',
      RESEND_WEBHOOK_SECRET: 'whsec_resend_live_12345',
      OWNER_ALERT_EMAIL: 'owner@example.com, ops@example.com',
      OWNER_ALERT_PHONE: '+919876543210, 9876543211',
    }

    // Production fails boot if mock SMS/email notifications or ALLOW_MOCK_NOTIFICATIONS=true
    expect(() =>
      validateEnv({
        ...FULL_PROD_BASE_ENV,
        SMS_PROVIDER: 'mock',
      }),
    ).toThrow()

    expect(() =>
      validateEnv({
        ...FULL_PROD_BASE_ENV,
        EMAIL_PROVIDER: 'mock',
      }),
    ).toThrow()

    expect(() =>
      validateEnv({
        ...FULL_PROD_BASE_ENV,
        ALLOW_MOCK_NOTIFICATIONS: 'true',
      }),
    ).toThrow()

    // Missing OTP_HMAC_SECRET, EMAIL_FROM, RESEND_WEBHOOK_SECRET, or DLT template fails prod boot
    const withoutOtpSecret = { ...FULL_PROD_BASE_ENV }
    delete (withoutOtpSecret as Record<string, string>).OTP_HMAC_SECRET
    expect(() => validateEnv(withoutOtpSecret)).toThrow()

    const withoutResendWebhook = { ...FULL_PROD_BASE_ENV }
    delete (withoutResendWebhook as Record<string, string>).RESEND_WEBHOOK_SECRET
    expect(() => validateEnv(withoutResendWebhook)).toThrow()

    const withoutPickupDlt = { ...FULL_PROD_BASE_ENV }
    delete (withoutPickupDlt as Record<string, string>).MSG91_DLT_TEMPLATE_PICKUP_CODE
    expect(() => validateEnv(withoutPickupDlt)).toThrow()

    // Invalid EMAIL_FROM or invalid OWNER_ALERT_PHONE fails validation
    expect(() =>
      validateEnv({
        ...FULL_PROD_BASE_ENV,
        EMAIL_FROM: 'not-an-email',
      }),
    ).toThrow()

    expect(() =>
      validateEnv({
        ...FULL_PROD_BASE_ENV,
        OWNER_ALERT_PHONE: '+15551234567',
      }),
    ).toThrow()

    const validProd = validateEnv(FULL_PROD_BASE_ENV)
    expect(validProd.PAYMENT_GATEWAY).toBe('razorpay')
    expect(validProd.SMS_PROVIDER).toBe('msg91')
    expect(validProd.EMAIL_PROVIDER).toBe('resend')
    expect(validProd.OWNER_ALERT_EMAIL).toEqual(['owner@example.com', 'ops@example.com'])
    expect(validProd.OWNER_ALERT_PHONE).toEqual(['+919876543210', '+919876543211'])
  })
})
