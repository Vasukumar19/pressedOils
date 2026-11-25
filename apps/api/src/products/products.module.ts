import { Module } from '@nestjs/common'
import { ProductCacheService } from './products.cache'
import { ProductsController } from './products.controller'
import { ProductsService } from './products.service'

@Module({
  controllers: [ProductsController],
  providers: [ProductCacheService, ProductsService],
  exports: [ProductCacheService, ProductsService],
})
export class ProductsModule {}
