import { Module } from '@nestjs/common'
import { PincodeModule } from '../pincode/pincode.module'
import { SettingsModule } from '../settings/settings.module'
import { CartRateLimitService } from './cart-rate-limit.service'
import { CartSessionService } from './cart-session.service'
import { CartController } from './cart.controller'
import { CartService } from './cart.service'

@Module({
  imports: [PincodeModule, SettingsModule],
  controllers: [CartController],
  providers: [CartService, CartSessionService, CartRateLimitService],
})
export class CartModule {}
