import { Body, Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import {
  type CartValidateRequest,
  cartValidateRequestSchema,
  type CartValidateResponseDto,
} from '@pressedoils/shared'
import type { Request, Response } from 'express'
import { getRealClientIp } from '../common/client-ip'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { CartRateLimitService } from './cart-rate-limit.service'
import { CartService } from './cart.service'
import { CartSessionService } from './cart-session.service'

@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly cartSessionService: CartSessionService,
    private readonly cartRateLimitService: CartRateLimitService,
  ) {}

  @Post('validate')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Validate cart items, quantities, live PostgreSQL prices/stock, coupons, pincode shipping, and store pickup',
  })
  @ApiHeader({
    name: 'x-cart-session',
    required: false,
    description: 'HMAC-signed anonymous cart session token issued by the API',
  })
  @ApiResponse({ status: 200, description: 'Authoritative server-computed cart breakdown' })
  @ApiResponse({ status: 400, description: 'Invalid input or unavailable store pickup selection' })
  @ApiResponse({
    status: 429,
    description: 'Cart validation or invalid coupon rate limit exceeded',
  })
  async validate(
    @Body(new ZodValidationPipe(cartValidateRequestSchema)) body: CartValidateRequest,
    @Headers('x-cart-session') sessionTokenHeader: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartValidateResponseDto> {
    const ip = getRealClientIp(req)
    const session = this.cartSessionService.resolveOrCreateSession(sessionTokenHeader)

    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Cart-Session', session.token)

    await this.cartRateLimitService.enforceValidateRateLimit(ip, session)
    return this.cartService.validate(body, { ip, sessionId: session.sessionId })
  }
}
