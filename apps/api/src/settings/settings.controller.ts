import { Controller, Get, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { PublicSettingsResponseDto } from '@pressedoils/shared'
import type { Request, Response } from 'express'
import { sendWithHttpCache } from '../common/http-cache'
import { SettingsService } from './settings.service'

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get public store info, thresholds, and GST configuration' })
  @ApiResponse({ status: 200, description: 'Public store settings' })
  async getPublicSettings(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicSettingsResponseDto | void> {
    const data = await this.settingsService.getPublicSettings()
    return sendWithHttpCache(req, res, data, 'public, max-age=60, s-maxage=300')
  }
}
