import 'dotenv/config'
import { indianPhoneSchema } from '@pressedoils/shared'
import { z } from 'zod'

const emailListSchema = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
  .refine((emails) => emails.every((e) => z.string().email().safeParse(e).success), {
    message: 'Every OWNER_ALERT_EMAIL entry must be a valid email address',
  })

const phoneListSchema = z
  .string()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .transform((phones, ctx) => {
    const normalized: string[] = []
    for (const p of phones) {
      const parsed = indianPhoneSchema.safeParse(p)
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid Indian mobile in OWNER_ALERT_PHONE: ${p}`,
        })
        return z.NEVER
      }
      normalized.push(parsed.data)
    }
    return normalized
  })

const emailFromSchema = z
  .string()
  .trim()
  .regex(
    /^([^<>]+<\s*)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+(\s*>)?$/,
    'EMAIL_FROM must contain a valid email address (e.g. "Brand <orders@domain.com>")',
  )

const corsOriginsSchema = z
  .string()
  .default('http://localhost:3000,http://localhost:3001')
  .transform((raw) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .refine((origins) => !origins.includes('*'), {
    message: 'CORS_ORIGINS cannot contain wildcard "*"',
  })
  .refine(
    (origins) =>
      origins.every((origin) => {
        try {
          const url = new URL(origin)
          return url.protocol === 'http:' || url.protocol === 'https:'
        } catch {
          return false
        }
      }),
    { message: 'Every CORS_ORIGINS entry must be a valid http(s) origin' },
  )

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(4000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    IS_PRODUCTION_DB: z.enum(['true', 'false']).default('false'),
    SHOW_SAMPLE_DATA_BANNER: z.enum(['true', 'false']).default('false'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
    DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().url().optional(),
    QUEUE_REDIS_URL: z.string().url().optional(),
    CORS_ORIGINS: corsOriginsSchema,
    TRUST_PROXY: z.string().trim().default('false'),
    MAX_QTY_PER_VARIANT: z.coerce.number().int().min(1).max(50).default(10),
    REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(50).max(2000).default(200),
    DB_POOL_LIMIT: z.coerce.number().int().min(2).max(100).default(10),
    DB_POOL_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
    DB_SLOW_QUERY_MS: z.coerce.number().int().min(50).max(5000).default(200),
    SWAGGER_USER: z.string().trim().min(1).optional(),
    SWAGGER_PASSWORD: z.string().trim().min(8).optional(),
    SWAGGER_IP_ALLOWLIST: z
      .string()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    CDN_ALLOWED_HOSTS: z
      .string()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    CART_SESSION_SECRET: z.string().trim().min(16).optional(),
    OWNER_SETTINGS_SECRET: z.string().trim().min(16).optional(),
    PICKUP_CODE_HMAC_SECRET: z.string().trim().min(16).optional(),
    PAYMENT_GATEWAY: z.enum(['razorpay', 'mock']).optional(),
    ALLOW_MOCK_GATEWAY: z.enum(['true', 'false']).default('false'),
    ENABLE_TEMP_ADMIN_API: z.enum(['true', 'false']).default('false'),
    TEMP_ADMIN_IP_ALLOWLIST: z
      .string()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    RAZORPAY_KEY_ID: z.string().trim().min(1).optional(),
    RAZORPAY_KEY_SECRET: z.string().trim().min(1).optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
    OTP_HMAC_SECRET: z.string().trim().min(16).optional(),
    SMS_PROVIDER: z.enum(['msg91', 'mock']).optional(),
    EMAIL_PROVIDER: z.enum(['resend', 'mock']).optional(),
    ALLOW_MOCK_NOTIFICATIONS: z.enum(['true', 'false']).default('false'),
    MSG91_AUTH_KEY: z.string().trim().min(1).optional(),
    MSG91_SENDER_ID: z.string().trim().min(3).max(11).optional(),
    MSG91_WEBHOOK_SECRET: z.string().trim().min(16).optional(),
    MSG91_DLT_TEMPLATE_OTP: z.string().trim().min(1).optional(),
    MSG91_DLT_TEMPLATE_ORDER_CONFIRMED: z.string().trim().min(1).optional(),
    MSG91_DLT_TEMPLATE_ORDER_SHIPPED: z.string().trim().min(1).optional(),
    MSG91_DLT_TEMPLATE_ORDER_DELIVERED: z.string().trim().min(1).optional(),
    MSG91_DLT_TEMPLATE_ORDER_READY_FOR_PICKUP: z.string().trim().min(1).optional(),
    MSG91_DLT_TEMPLATE_PICKUP_CODE: z.string().trim().min(1).optional(),
    MSG91_DLT_TEMPLATE_OWNER_ALERT: z.string().trim().min(1).optional(),
    MSG91_DLT_TEMPLATE_ORDER_UPDATE: z.string().trim().min(1).optional(),
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    EMAIL_FROM: emailFromSchema.optional(),
    RESEND_WEBHOOK_SECRET: z.string().trim().min(16).optional(),
    TURNSTILE_SITE_KEY: z.string().trim().min(1).optional(),
    TURNSTILE_SECRET_KEY: z.string().trim().min(1).optional(),
    OWNER_ALERT_EMAIL: emailListSchema,
    OWNER_ALERT_PHONE: phoneListSchema,
    UPTIME_ALERT_WEBHOOK_URL: z.string().trim().url().optional(),
    SMS_LOW_BALANCE_THRESHOLD: z.coerce.number().int().min(0).default(500),
    SENTRY_DSN: z.string().trim().url().optional(),
    LEGAL_PRIVACY_VERSION: z.string().trim().min(1).default('2026-11-draft-v1'),
  })
  .transform((data) => ({
    ...data,
    PAYMENT_GATEWAY: data.PAYMENT_GATEWAY ?? (data.APP_ENV === 'production' ? 'razorpay' : 'mock'),
    SMS_PROVIDER: data.SMS_PROVIDER ?? (data.APP_ENV === 'production' ? 'msg91' : 'mock'),
    EMAIL_PROVIDER: data.EMAIL_PROVIDER ?? (data.APP_ENV === 'production' ? 'resend' : 'mock'),
  }))
  .superRefine((data, ctx) => {
    const isProdTarget = data.APP_ENV === 'production' || data.IS_PRODUCTION_DB === 'true'

    if (isProdTarget && (data.PAYMENT_GATEWAY === 'mock' || data.ALLOW_MOCK_GATEWAY === 'true')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_GATEWAY'],
        message:
          'Mock payment gateway cannot be enabled when APP_ENV=production or IS_PRODUCTION_DB=true',
      })
    }

    if (isProdTarget && data.ENABLE_TEMP_ADMIN_API === 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENABLE_TEMP_ADMIN_API'],
        message: 'Temporary X-Admin-Secret admin endpoints cannot be enabled in production',
      })
    }

    if (
      isProdTarget &&
      (data.SMS_PROVIDER === 'mock' ||
        data.EMAIL_PROVIDER === 'mock' ||
        data.ALLOW_MOCK_NOTIFICATIONS === 'true')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_PROVIDER'],
        message:
          'Mock SMS/email transports cannot be enabled when APP_ENV=production or IS_PRODUCTION_DB=true',
      })
    }

    if (data.APP_ENV === 'production') {
      if (!data.PICKUP_CODE_HMAC_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PICKUP_CODE_HMAC_SECRET'],
          message: 'PICKUP_CODE_HMAC_SECRET is required in production',
        })
      }
      if (!data.RAZORPAY_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RAZORPAY_WEBHOOK_SECRET'],
          message: 'RAZORPAY_WEBHOOK_SECRET is required in production',
        })
      }
      if (!data.OTP_HMAC_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_HMAC_SECRET'],
          message: 'OTP_HMAC_SECRET is required in production',
        })
      }

      const requiredSmsFields: Array<[keyof typeof data, string]> = [
        ['MSG91_AUTH_KEY', 'MSG91_AUTH_KEY'],
        ['MSG91_SENDER_ID', 'MSG91_SENDER_ID'],
        ['MSG91_DLT_TEMPLATE_OTP', 'MSG91_DLT_TEMPLATE_OTP'],
        ['MSG91_DLT_TEMPLATE_ORDER_CONFIRMED', 'MSG91_DLT_TEMPLATE_ORDER_CONFIRMED'],
        ['MSG91_DLT_TEMPLATE_ORDER_SHIPPED', 'MSG91_DLT_TEMPLATE_ORDER_SHIPPED'],
        ['MSG91_DLT_TEMPLATE_ORDER_DELIVERED', 'MSG91_DLT_TEMPLATE_ORDER_DELIVERED'],
        ['MSG91_DLT_TEMPLATE_ORDER_READY_FOR_PICKUP', 'MSG91_DLT_TEMPLATE_ORDER_READY_FOR_PICKUP'],
        ['MSG91_DLT_TEMPLATE_PICKUP_CODE', 'MSG91_DLT_TEMPLATE_PICKUP_CODE'],
        ['MSG91_DLT_TEMPLATE_OWNER_ALERT', 'MSG91_DLT_TEMPLATE_OWNER_ALERT'],
        ['MSG91_DLT_TEMPLATE_ORDER_UPDATE', 'MSG91_DLT_TEMPLATE_ORDER_UPDATE'],
      ]
      for (const [key, label] of requiredSmsFields) {
        if (!data[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${label} is required in production`,
          })
        }
      }

      if (!data.RESEND_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RESEND_API_KEY'],
          message: 'RESEND_API_KEY is required in production',
        })
      }
      if (!data.EMAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM'],
          message: 'EMAIL_FROM is required in production',
        })
      }
      if (!data.RESEND_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RESEND_WEBHOOK_SECRET'],
          message: 'RESEND_WEBHOOK_SECRET is required in production',
        })
      }
    }

    if (data.SMS_PROVIDER === 'msg91' && (isProdTarget || data.NODE_ENV !== 'test')) {
      if (!data.MSG91_AUTH_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MSG91_AUTH_KEY'],
          message: 'MSG91_AUTH_KEY is required when SMS_PROVIDER=msg91',
        })
      }
      if (!data.MSG91_SENDER_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MSG91_SENDER_ID'],
          message: 'MSG91_SENDER_ID is required when SMS_PROVIDER=msg91',
        })
      }
    }

    if (data.EMAIL_PROVIDER === 'resend' && (isProdTarget || data.NODE_ENV !== 'test')) {
      if (!data.RESEND_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RESEND_API_KEY'],
          message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
        })
      }
      if (!data.EMAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_FROM'],
          message: 'EMAIL_FROM is required when EMAIL_PROVIDER=resend',
        })
      }
    }

    if (data.PAYMENT_GATEWAY === 'razorpay' && (isProdTarget || data.NODE_ENV !== 'test')) {
      if (!data.RAZORPAY_KEY_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RAZORPAY_KEY_ID'],
          message: 'RAZORPAY_KEY_ID is required when PAYMENT_GATEWAY=razorpay',
        })
      }
      if (!data.RAZORPAY_KEY_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RAZORPAY_KEY_SECRET'],
          message: 'RAZORPAY_KEY_SECRET is required when PAYMENT_GATEWAY=razorpay',
        })
      }
    }

    if (data.APP_ENV === 'production' || data.APP_ENV === 'staging') {
      if (!data.CART_SESSION_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CART_SESSION_SECRET'],
          message: 'CART_SESSION_SECRET is required in staging and production',
        })
      }
    }
    if (data.NODE_ENV !== 'test') {
      if (!data.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL is required outside of test mode',
        })
      }
      if (!data.REDIS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message: 'REDIS_URL is required outside of test mode',
        })
      }
      if (!data.QUEUE_REDIS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['QUEUE_REDIS_URL'],
          message: 'QUEUE_REDIS_URL is required outside of test mode',
        })
      }
    }
    if (data.APP_ENV === 'staging') {
      const hasBasicAuth = Boolean(data.SWAGGER_USER && data.SWAGGER_PASSWORD)
      const hasIpAllowlist = data.SWAGGER_IP_ALLOWLIST.length > 0
      if (!hasBasicAuth && !hasIpAllowlist) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SWAGGER_USER'],
          message:
            'In staging, configure SWAGGER_USER+SWAGGER_PASSWORD or SWAGGER_IP_ALLOWLIST so Swagger UI is not open to the internet',
        })
      }
    }
  })

export type Env = z.infer<typeof envSchema>

export function parseTrustProxy(value: string): boolean | number | string {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'false' || trimmed === '') return false
  if (trimmed === 'true') return 1 // never blindly trust unlimited proxy hops
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  return value.trim()
}

export function validateEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors)
    throw new Error('Invalid environment configuration')
  }
  return result.data
}

export const env = validateEnv()
