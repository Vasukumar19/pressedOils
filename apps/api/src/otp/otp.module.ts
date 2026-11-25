import { Module } from '@nestjs/common'
import { CartModule } from '../cart/cart.module'
import { SettingsModule } from '../settings/settings.module'
import { OtpController } from './otp.controller'
import { OtpService } from './otp.service'
import { TurnstileService } from './turnstile.service'

@Module({
  imports: [CartModule, SettingsModule],
  controllers: [OtpController],
  providers: [TurnstileService, OtpService],
  exports: [TurnstileService, OtpService],
})
export class OtpModule {}
