import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'
import { CartModule } from './cart/cart.module'
import { CheckoutModule } from './checkout/checkout.module'
import { env } from './env'
import { PincodeModule } from './pincode/pincode.module'
import { PrismaModule } from './prisma/prisma.module'
import { ProductsModule } from './products/products.module'
import { QueueModule } from './queue/queue.module'
import { RedisModule } from './redis/redis.module'
import { SettingsModule } from './settings/settings.module'

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
        autoLogging: false,
      },
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    SettingsModule,
    ProductsModule,
    PincodeModule,
    CartModule,
    CheckoutModule,
  ],
})
export class WorkerModule {}
