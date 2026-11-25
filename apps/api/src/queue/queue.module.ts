import { Global, Module } from '@nestjs/common'
import { OpsAlertService } from './ops-alert.service'
import { QueueService } from './queue.service'

@Global()
@Module({
  providers: [QueueService, OpsAlertService],
  exports: [QueueService, OpsAlertService],
})
export class QueueModule {}
