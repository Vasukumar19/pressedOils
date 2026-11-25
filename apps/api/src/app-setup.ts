import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { AllExceptionsFilter } from './common/all-exceptions.filter'
import { requestIdMiddleware } from './common/request-id.middleware'
import { createDocsAuthMiddleware } from './common/swagger-auth'
import { type Env, parseTrustProxy } from './env'

export function buildOpenApiConfig() {
  return new DocumentBuilder()
    .setTitle('[YOUR BRAND] Public API')
    .setDescription('Single-brand cold-pressed oil storefront & operations API')
    .setVersion('0.2.0')
    .addTag('health', 'Liveness and readiness probes')
    .addTag('products', 'Catalog, product detail, and live availability')
    .addTag('cart', 'Server cart validation, pricing, coupons, and fulfilment checks')
    .addTag('checkout', 'Checkout, inventory reservations, COD, and Razorpay verification')
    .addTag('pincode', 'Delivery serviceability, TAT, COD, and shipping fees')
    .addTag('settings', 'Public store configuration and thresholds')
    .addTag('admin-settings', 'Protected owner settings controls (pre-Phase 9)')
    .build()
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildOpenApiConfig())
}

export function configureApp(app: INestApplication, currentEnv: Env): void {
  const expressApp = app.getHttpAdapter().getInstance() as Express

  expressApp.set('trust proxy', parseTrustProxy(currentEnv.TRUST_PROXY))
  expressApp.use(requestIdMiddleware)
  expressApp.use(helmet())
  expressApp.use(express.json({ limit: '100kb' }))
  expressApp.use(express.urlencoded({ extended: true, limit: '100kb' }))

  app.setGlobalPrefix('api')
  app.useGlobalFilters(new AllExceptionsFilter())

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true)
        return
      }
      callback(null, currentEnv.CORS_ORIGINS.includes(origin))
    },
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Idempotency-Key',
      'X-Cart-Session',
      'X-Admin-Secret',
      'X-Admin-Email',
    ],
    exposedHeaders: ['X-Request-Id', 'X-Cart-Session'],
  })

  // Swagger UI: enabled in dev, gated by auth/IP allowlist in staging, disabled in production
  if (currentEnv.APP_ENV !== 'production') {
    expressApp.use('/api/docs', createDocsAuthMiddleware(currentEnv))
    const document = createOpenApiDocument(app)
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: false },
    })
  }
}
