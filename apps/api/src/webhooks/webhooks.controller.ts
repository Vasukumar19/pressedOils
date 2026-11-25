import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { WebhookAckResponseDto } from '@pressedoils/shared'
import type { Request } from 'express'
import { WebhooksService } from './webhooks.service'

type RawBodyRequest = Request & { rawBody?: Buffer }

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('razorpay')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Receive and process Razorpay webhooks (verifies X-Razorpay-Signature over exact raw bytes first)',
  })
  @ApiHeader({
    name: 'x-razorpay-signature',
    required: true,
    description: 'HMAC-SHA256 signature computed over the exact raw request body',
  })
  @ApiHeader({
    name: 'x-razorpay-event-id',
    required: false,
    description: 'Unique Razorpay event delivery identifier for strict idempotent deduplication',
  })
  @ApiResponse({ status: 200, description: 'Webhook verified and acknowledged' })
  @ApiResponse({ status: 401, description: 'Invalid or missing Razorpay webhook signature' })
  async handleRazorpayWebhook(
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventIdHeader: string | undefined,
    @Req() req: RawBodyRequest,
  ): Promise<WebhookAckResponseDto> {
    return this.webhooksService.handleRazorpayWebhook({
      rawBody: req.rawBody,
      signature,
      eventIdHeader,
    })
  }
}
