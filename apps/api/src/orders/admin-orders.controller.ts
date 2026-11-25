import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import {
  type AdminCancelOrderDto,
  adminCancelOrderSchema,
  type AdminCancelOrderResponseDto,
  type AdminConfirmOrderDto,
  adminConfirmOrderSchema,
  type AdminOrderTransitionResponseDto,
  type AdminPackOrderDto,
  adminPackOrderSchema,
  type AdminPickupCompleteDto,
  adminPickupCompleteSchema,
  type AdminRefundOrderDto,
  adminRefundOrderSchema,
  type AdminRefundOrderResponseDto,
  type AdminReturnStockDto,
  adminReturnStockSchema,
  type AdminReturnStockResponseDto,
  type AdminShipOrderDto,
  adminShipOrderSchema,
} from '@pressedoils/shared'
import { TempAdminGuard } from '../common/temp-admin.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { OrdersService } from './orders.service'

@ApiTags('admin-orders')
@Controller('admin/orders')
@UseGuards(TempAdminGuard)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post(':id/confirm')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Temporary admin endpoint to transition a PAID or COD_PENDING order to CONFIRMED (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  @ApiResponse({ status: 200, description: 'Order confirmed cleanly' })
  @ApiResponse({ status: 403, description: 'Disabled in production or invalid admin credentials' })
  async confirmOrder(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Headers('x-admin-email') email: string | undefined,
    @Body(new ZodValidationPipe(adminConfirmOrderSchema.default({}))) body: AdminConfirmOrderDto,
  ) {
    return this.ordersService.confirmOrder(orderId, email, body)
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Cancel an unshipped order, restore stock ONCE, write AuditLog, and initiate refund if paid (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  @ApiResponse({ status: 200, description: 'Order cancelled and stock restored cleanly' })
  @ApiResponse({ status: 409, description: 'Order already cancelled; double-restock prevented' })
  async cancelOrder(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Headers('x-admin-email') email: string | undefined,
    @Body(new ZodValidationPipe(adminCancelOrderSchema)) body: AdminCancelOrderDto,
  ): Promise<AdminCancelOrderResponseDto> {
    return this.ordersService.cancelOrder(orderId, email, body)
  }

  @Post(':id/refund')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Initiate a full or partial Razorpay refund with Idempotency-Key; finalized by refund.processed webhook (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiResponse({ status: 200, description: 'Refund initiated (or idempotent replay)' })
  async refundOrder(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Headers('x-admin-email') email: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(adminRefundOrderSchema)) body: AdminRefundOrderDto,
  ): Promise<AdminRefundOrderResponseDto> {
    return this.ordersService.refundOrder(orderId, email, idempotencyKey, body)
  }

  @Post(':id/return-stock')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Record inspected physical return stock (sealed restock vs damaged write-off) on post-shipment orders (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  @ApiResponse({ status: 200, description: 'Return stock inspection recorded cleanly' })
  async returnOrderStock(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Headers('x-admin-email') email: string | undefined,
    @Body(new ZodValidationPipe(adminReturnStockSchema)) body: AdminReturnStockDto,
  ): Promise<AdminReturnStockResponseDto> {
    return this.ordersService.returnOrderStock(orderId, email, body)
  }

  @Post(':id/pack')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Transition CONFIRMED order to PACKED and notify customer (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  async packOrder(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Headers('x-admin-email') email: string | undefined,
    @Body(new ZodValidationPipe(adminPackOrderSchema.default({}))) body: AdminPackOrderDto,
  ): Promise<AdminOrderTransitionResponseDto> {
    return this.ordersService.packOrder(orderId, email, body)
  }

  @Post(':id/ship')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Transition PACKED delivery order to SHIPPED with tracking URL (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  async shipOrder(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Headers('x-admin-email') email: string | undefined,
    @Body(new ZodValidationPipe(adminShipOrderSchema.default({}))) body: AdminShipOrderDto,
  ): Promise<AdminOrderTransitionResponseDto> {
    return this.ordersService.shipOrder(orderId, email, body)
  }

  @Post(':id/ready-for-pickup')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Transition PACKED pickup order to READY_FOR_PICKUP, generate fresh 6-digit pickup code, and send SMS/email (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  async readyForPickup(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Headers('x-admin-email') email: string | undefined,
  ): Promise<AdminOrderTransitionResponseDto> {
    return this.ordersService.markReadyForPickup(orderId, email)
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Transition SHIPPED order to DELIVERED and notify customer (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  async deliverOrder(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Headers('x-admin-email') email: string | undefined,
  ): Promise<AdminOrderTransitionResponseDto> {
    return this.ordersService.markDelivered(orderId, email)
  }

  @Post(':id/pickup-complete')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Complete store pickup (verifies 6-digit code or order number + photo ID fallback) and notify customer (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  async pickupComplete(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Headers('x-admin-email') email: string | undefined,
    @Body(new ZodValidationPipe(adminPickupCompleteSchema)) body: AdminPickupCompleteDto,
  ): Promise<AdminOrderTransitionResponseDto> {
    return this.ordersService.completeStorePickup(orderId, email, body)
  }
}
