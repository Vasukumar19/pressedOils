import 'dotenv/config'
import { z } from 'zod'

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
    OWNER_ALERT_EMAIL: z.string().trim().email().optional(),
    SENTRY_DSN: z.string().trim().url().optional(),
    LEGAL_PRIVACY_VERSION: z.string().trim().min(1).default('2026-11-draft-v1'),
  })
  .transform((data) => ({
    ...data,
    PAYMENT_GATEWAY: data.PAYMENT_GATEWAY ?? (data.APP_ENV === 'production' ? 'razorpay' : 'mock'),
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
