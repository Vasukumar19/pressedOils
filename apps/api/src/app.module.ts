import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'
import { ThrottlerIpGuard } from './common/throttler-ip.guard'
import { env } from './env'
import { HealthModule } from './health/health.module'
import { PincodeModule } from './pincode/pincode.module'
import { PrismaModule } from './prisma/prisma.module'
import { ProductsModule } from './products/products.module'
import { RedisModule } from './redis/redis.module'
import { ResilientThrottlerStorage } from './redis/resilient-throttler.storage'
import { SettingsModule } from './settings/settings.module'

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
            '*.password',
            '*.passwordHash',
            '*.token',
            '*.phone',
            '*.email',
            '*.totp_secret',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
    PrismaModule,
    RedisModule,
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
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerIpGuard,
    },
  ],
})
export class AppModule {}
