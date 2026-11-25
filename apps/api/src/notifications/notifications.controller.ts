import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request } from 'express'
import { NotificationsService } from './notifications.service'

type RawBodyRequest = Request & { rawBody?: Buffer }

@ApiTags('webhooks')
@Controller('webhooks')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('resend')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Receive Resend delivery, bounce, and complaint webhooks (verifies Svix HMAC signature and updates email suppression list)',
  })
  @ApiHeader({ name: 'svix-id', required: true })
  @ApiHeader({ name: 'svix-timestamp', required: true })
  @ApiHeader({ name: 'svix-signature', required: true })
  @ApiResponse({ status: 200, description: 'Resend webhook acknowledged' })
  @ApiResponse({ status: 401, description: 'Invalid Resend webhook signature' })
  async handleResendWebhook(
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
    @Req() req: RawBodyRequest,
  ) {
    return this.notificationsService.handleResendWebhook({
      rawBody: req.rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
    })
  }

  @Post('msg91')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Receive MSG91 SMS delivery report callbacks with constant-time shared secret verification',
  })
  @ApiHeader({ name: 'x-msg91-webhook-secret', required: true })
  @ApiResponse({ status: 200, description: 'MSG91 delivery report acknowledged' })
  @ApiResponse({ status: 401, description: 'Invalid MSG91 webhook secret' })
  async handleMsg91Webhook(
    @Headers('x-msg91-webhook-secret') secretHeader: string | undefined,
    @Headers('x-msg91-event-id') eventIdHeader: string | undefined,
    @Req() req: RawBodyRequest,
  ) {
    return this.notificationsService.handleMsg91Webhook({
      rawBody: req.rawBody,
      webhookSecretHeader: secretHeader,
      eventIdHeader,
    })
  }
}
