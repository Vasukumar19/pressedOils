import { Module } from '@nestjs/common'
import { AdminSettingsController } from './admin-settings.controller'
import { OwnerSettingsService } from './owner-settings.service'
import { SettingsController } from './settings.controller'
import { SettingsService } from './settings.service'

@Module({
  controllers: [SettingsController, AdminSettingsController],
  providers: [SettingsService, OwnerSettingsService],
  exports: [SettingsService, OwnerSettingsService],
})
export class SettingsModule {}
