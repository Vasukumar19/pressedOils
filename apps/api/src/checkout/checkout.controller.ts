import { Body, Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import {
  type CheckoutFailRequest,
  checkoutFailRequestSchema,
  type CheckoutFailResponseDto,
  type CheckoutRequest,
  checkoutRequestSchema,
  type CheckoutResponseDto,
  type CheckoutVerifyRequest,
  checkoutVerifyRequestSchema,
  type CheckoutVerifyResponseDto,
} from '@pressedoils/shared'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { CartSessionService } from '../cart/cart-session.service'
import { getRealClientIp } from '../common/client-ip'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { CheckoutRateLimitService } from './checkout-rate-limit.service'
import { CheckoutService } from './checkout.service'

@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly cartSessionService: CartSessionService,
    private readonly checkoutRateLimitService: CheckoutRateLimitService,
  ) {}

  @Post()
  @HttpCode(201)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Place a COD/Pay-at-store order or initialize an Online payment with 15-minute stock reservation',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    description: 'Unique client-generated key (16-128 chars) preventing duplicate order placement',
  })
  @ApiHeader({
    name: 'x-cart-session',
    required: false,
    description: 'Signed anonymous cart session token issued by API',
  })
  @ApiResponse({
    status: 201,
    description: 'Order created (COD confirmed or Online payment session ready)',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error, unserviceable pincode, or COD disallowed',
  })
  @ApiResponse({
    status: 403,
    description: 'Checkout disabled in production until legal pages approved',
  })
  @ApiResponse({
    status: 409,
    description: 'Insufficient stock or Idempotency-Key payload mismatch',
  })
  @ApiResponse({ status: 429, description: 'Checkout rate limit exceeded' })
  async createCheckout(
    @Body(new ZodValidationPipe(checkoutRequestSchema)) body: CheckoutRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-cart-session') sessionTokenHeader: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutResponseDto> {
    const ip = getRealClientIp(req)
    const session = this.cartSessionService.resolveOrCreateSession(sessionTokenHeader)

    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('X-Cart-Session', session.token)

    await this.checkoutRateLimitService.enforceCreateRateLimit(ip, session)
    return this.checkoutService.createOrder(body, idempotencyKey, {
      ip,
      sessionId: session.sessionId,
    })
  }

  @Post('verify')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Verify Razorpay HMAC payment signature and atomically transition order to PAID',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment verified and order marked PAID (or idempotent replay)',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid signature or mismatched order payment reference',
  })
  async verifyCheckoutPayment(
    @Body(new ZodValidationPipe(checkoutVerifyRequestSchema)) body: CheckoutVerifyRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutVerifyResponseDto> {
    const ip = getRealClientIp(req)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    await this.checkoutRateLimitService.enforceVerifyOrFailRateLimit(ip)
    return this.checkoutService.verifyPayment(body)
  }

  @Post('fail')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Cancel pending checkout on gateway failure/dismissal and release reserved stock',
  })
  @ApiResponse({ status: 200, description: 'Pending stock reservation released cleanly' })
  async failCheckoutPayment(
    @Body(new ZodValidationPipe(checkoutFailRequestSchema)) body: CheckoutFailRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutFailResponseDto> {
    const ip = getRealClientIp(req)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    await this.checkoutRateLimitService.enforceVerifyOrFailRateLimit(ip)
    return this.checkoutService.failOrCancelCheckout(body)
  }

  @Post('mock-complete')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Non-production dev/staging helper to complete mock online payment (403 in production)',
  })
  async mockCompleteCheckoutPayment(
    @Body(new ZodValidationPipe(z.object({ orderId: z.string().uuid() }).strict()))
    body: { orderId: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckoutVerifyResponseDto> {
    const ip = getRealClientIp(req)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    await this.checkoutRateLimitService.enforceVerifyOrFailRateLimit(ip)
    return this.checkoutService.mockCompleteOnlinePayment(body.orderId)
  }
}
