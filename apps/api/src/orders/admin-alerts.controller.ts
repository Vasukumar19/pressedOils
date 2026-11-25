import { Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import {
  type AdminTestAlertDto,
  adminTestAlertSchema,
  type AdminTestAlertResponseDto,
} from '@pressedoils/shared'
import { TempAdminGuard } from '../common/temp-admin.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { OrdersService } from './orders.service'

@ApiTags('admin-orders')
@Controller('admin/alerts')
@UseGuards(TempAdminGuard)
export class AdminAlertsController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('test')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Send a staging test alert across logs, Sentry, external uptime webhook, owner email, and SMS (disabled in prod)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  @ApiResponse({ status: 200, description: 'Test alert dispatched across configured channels' })
  @ApiResponse({ status: 403, description: 'Disabled in production or invalid admin credentials' })
  async sendTestAlert(
    @Headers('x-admin-email') email: string | undefined,
    @Body(new ZodValidationPipe(adminTestAlertSchema.default({}))) body: AdminTestAlertDto,
  ): Promise<AdminTestAlertResponseDto> {
    return this.ordersService.triggerTestOwnerAlert(email, body)
  }
}
