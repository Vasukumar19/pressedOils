import { Body, Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import {
  type OtpSendRequestDto,
  otpSendRequestSchema,
  type OtpSendResponseDto,
  type OtpVerifyRequestDto,
  otpVerifyRequestSchema,
  type OtpVerifyResponseDto,
} from '@pressedoils/shared'
import type { Request, Response } from 'express'
import { CartSessionService } from '../cart/cart-session.service'
import { getRealClientIp } from '../common/client-ip'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { OtpService } from './otp.service'

@ApiTags('otp')
@Controller('otp')
export class OtpController {
  constructor(
    private readonly otpService: OtpService,
    private readonly cartSessionService: CartSessionService,
  ) {}

  @Post('send')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Send a 6-digit Indian mobile OTP (COD verification, order tracking, or pickup code reissue) with SMS pumping protection',
  })
  @ApiHeader({
    name: 'x-cart-session',
    required: false,
    description: 'Signed anonymous cart session token binding OTP tokens to browser session',
  })
  @ApiResponse({ status: 200, description: 'OTP issued and dispatched cleanly via SMS' })
  @ApiResponse({ status: 400, description: 'Invalid Indian mobile or CAPTCHA required' })
  @ApiResponse({ status: 429, description: 'Cooldown or hourly OTP limit exceeded' })
  async sendOtp(
    @Body(new ZodValidationPipe(otpSendRequestSchema)) body: OtpSendRequestDto,
    @Headers('x-cart-session') sessionTokenHeader: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OtpSendResponseDto> {
    const ip = getRealClientIp(req)
    const session = this.cartSessionService.resolveOrCreateSession(sessionTokenHeader)

    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('X-Cart-Session', session.token)

    return this.otpService.sendOtp(body, { ip, sessionId: session.sessionId })
  }

  @Post('verify')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Verify a 6-digit OTP and issue a single-use, 15-minute phone verification token bound to phone and session',
  })
  @ApiHeader({
    name: 'x-cart-session',
    required: false,
    description: 'Signed anonymous cart session token matching OTP issuance session',
  })
  @ApiResponse({
    status: 200,
    description: 'OTP verified; short-lived verification token returned',
  })
  @ApiResponse({ status: 400, description: 'Wrong code, expired OTP, or max attempts reached' })
  async verifyOtp(
    @Body(new ZodValidationPipe(otpVerifyRequestSchema)) body: OtpVerifyRequestDto,
    @Headers('x-cart-session') sessionTokenHeader: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OtpVerifyResponseDto> {
    const ip = getRealClientIp(req)
    const session = this.cartSessionService.resolveOrCreateSession(sessionTokenHeader)

    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('X-Cart-Session', session.token)

    return this.otpService.verifyOtp(body, { ip, sessionId: session.sessionId })
  }
}
