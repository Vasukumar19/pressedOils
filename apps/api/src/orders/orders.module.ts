import { Module } from '@nestjs/common'
import { CartModule } from '../cart/cart.module'
import { CheckoutModule } from '../checkout/checkout.module'
import { OtpModule } from '../otp/otp.module'
import { ProductsModule } from '../products/products.module'
import { SettingsModule } from '../settings/settings.module'
import { AdminAlertsController } from './admin-alerts.controller'
import { AdminOrdersController } from './admin-orders.controller'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'

@Module({
  imports: [CheckoutModule, ProductsModule, CartModule, OtpModule, SettingsModule],
  controllers: [OrdersController, AdminOrdersController, AdminAlertsController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
