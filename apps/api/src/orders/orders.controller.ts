import { Body, Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import {
  type PickupCodeReissueRequestDto,
  pickupCodeReissueRequestSchema,
  type PickupCodeReissueResponseDto,
} from '@pressedoils/shared'
import type { Request, Response } from 'express'
import { CartSessionService } from '../cart/cart-session.service'
import { getRealClientIp } from '../common/client-ip'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { OrdersService } from './orders.service'

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly cartSessionService: CartSessionService,
  ) {}

  @Post('pickup-code/reissue')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'OTP-protected customer request to rotate & resend a fresh 6-digit store pickup code (invalidates previous codes)',
  })
  @ApiHeader({
    name: 'x-cart-session',
    required: false,
    description: 'Signed session token matching the OTP verification session',
  })
  @ApiResponse({ status: 200, description: 'New pickup code generated and sent via SMS & email' })
  @ApiResponse({ status: 403, description: 'Invalid/expired OTP phone verification token' })
  @ApiResponse({ status: 429, description: 'Pickup code reissue rate/cooldown limit reached' })
  async reissuePickupCode(
    @Body(new ZodValidationPipe(pickupCodeReissueRequestSchema)) body: PickupCodeReissueRequestDto,
    @Headers('x-cart-session') sessionTokenHeader: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PickupCodeReissueResponseDto> {
    const ip = getRealClientIp(req)
    const session = this.cartSessionService.resolveOrCreateSession(sessionTokenHeader)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('X-Cart-Session', session.token)
    return this.ordersService.reissuePickupCode(body, { ip, sessionId: session.sessionId })
  }
}
