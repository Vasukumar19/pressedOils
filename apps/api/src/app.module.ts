import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'
import { CartModule } from './cart/cart.module'
import { CheckoutModule } from './checkout/checkout.module'
import { ThrottlerIpGuard } from './common/throttler-ip.guard'
import { env } from './env'
import { HealthModule } from './health/health.module'
import { NotificationsModule } from './notifications/notifications.module'
import { OrdersModule } from './orders/orders.module'
import { OtpModule } from './otp/otp.module'
import { PincodeModule } from './pincode/pincode.module'
import { PrismaModule } from './prisma/prisma.module'
import { ProductsModule } from './products/products.module'
import { QueueModule } from './queue/queue.module'
import { RedisModule } from './redis/redis.module'
import { ResilientThrottlerStorage } from './redis/resilient-throttler.storage'
import { SettingsModule } from './settings/settings.module'
import { WebhooksModule } from './webhooks/webhooks.module'

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
        autoLogging: env.NODE_ENV !== 'test',
        genReqId: (req) => (req as { id?: string }).id ?? '',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-api-key"]',
            'req.headers["x-admin-secret"]',
            '*.password',
            '*.passwordHash',
            '*.token',
            '*.phone',
            '*.email',
            '*.totp_secret',
            '*.pickupCode',
            '*.pickup_code_hash',
            '*.razorpaySignature',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    NotificationsModule,
    ThrottlerModule.forRootAsync({
      inject: [ResilientThrottlerStorage],
      useFactory: (storage: ResilientThrottlerStorage) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage,
      }),
    }),
    HealthModule,
    ProductsModule,
    PincodeModule,
    SettingsModule,
    CartModule,
    OtpModule,
    CheckoutModule,
    WebhooksModule,
    OrdersModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerIpGuard,
    },
  ],
})
export class AppModule {}
