import { Module } from '@nestjs/common'
import { CartModule } from '../cart/cart.module'
import { PincodeModule } from '../pincode/pincode.module'
import { ProductsModule } from '../products/products.module'
import { SettingsModule } from '../settings/settings.module'
import { CheckoutRateLimitService } from './checkout-rate-limit.service'
import { CheckoutSecurityService } from './checkout-security.service'
import { CheckoutController } from './checkout.controller'
import { CheckoutService } from './checkout.service'
import { PaymentGatewayService } from './payment-gateway.service'

@Module({
  imports: [PincodeModule, SettingsModule, ProductsModule, CartModule],
  controllers: [CheckoutController],
  providers: [
    PaymentGatewayService,
    CheckoutSecurityService,
    CheckoutRateLimitService,
    CheckoutService,
  ],
  exports: [CheckoutService, PaymentGatewayService],
})
export class CheckoutModule {}
