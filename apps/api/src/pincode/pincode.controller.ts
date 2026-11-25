import { Controller, Get, Param, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { indianPincodeSchema, type PincodeLookupResponseDto } from '@pressedoils/shared'
import type { Request, Response } from 'express'
import { sendWithHttpCache } from '../common/http-cache'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { PincodeService } from './pincode.service'

@ApiTags('pincode')
@Controller('pincode')
export class PincodeController {
  constructor(private readonly pincodeService: PincodeService) {}

  @Get(':pincode')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Check pincode serviceability, delivery days, COD, and shipping fee' })
  @ApiParam({ name: 'pincode', type: String, example: '600001' })
  @ApiResponse({
    status: 200,
    description: 'Uniform serviceability shape for found and unserviceable pincodes',
  })
  @ApiResponse({ status: 400, description: 'Invalid 6-digit Indian pincode' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async check(
    @Param('pincode', new ZodValidationPipe(indianPincodeSchema)) pincode: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PincodeLookupResponseDto | void> {
    const data = await this.pincodeService.check(pincode)
    return sendWithHttpCache(req, res, data, 'public, max-age=300, s-maxage=600')
  }
}
