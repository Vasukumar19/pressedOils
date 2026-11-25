import { Module } from '@nestjs/common'
import { CheckoutModule } from '../checkout/checkout.module'
import { ProductsModule } from '../products/products.module'
import { AdminOrdersController } from './admin-orders.controller'
import { OrdersService } from './orders.service'

@Module({
  imports: [CheckoutModule, ProductsModule],
  controllers: [AdminOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
