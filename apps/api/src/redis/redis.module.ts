import { Global, Module } from '@nestjs/common'
import { RedisService } from './redis.service'
import { ResilientThrottlerStorage } from './resilient-throttler.storage'

@Global()
@Module({
  providers: [RedisService, ResilientThrottlerStorage],
  exports: [RedisService, ResilientThrottlerStorage],
})
export class RedisModule {}
