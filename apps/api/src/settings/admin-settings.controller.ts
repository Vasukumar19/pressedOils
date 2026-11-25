import { timingSafeEqual } from 'node:crypto'
import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Patch,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  ownerUpdateSettingsSchema,
  type OwnerUpdateSettingsDto,
  type PublicSettingsResponseDto,
} from '@pressedoils/shared'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { env } from '../env'
import { OwnerSettingsService } from './owner-settings.service'

function isValidAdminSecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

@ApiTags('admin-settings')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly ownerSettingsService: OwnerSettingsService) {}

  @Patch()
  @ApiOperation({
    summary: 'Owner-only pre-Phase-9 settings switch (free shipping promo, pickup, tax display)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  @ApiResponse({ status: 200, description: 'Updated public settings snapshot (audit logged)' })
  @ApiResponse({ status: 403, description: 'Forbidden: invalid secret or non-OWNER admin' })
  @ApiResponse({ status: 503, description: 'OWNER_SETTINGS_SECRET not configured' })
  async updateSettings(
    @Headers('x-admin-secret') secret: string | undefined,
    @Headers('x-admin-email') email: string | undefined,
    @Body(new ZodValidationPipe(ownerUpdateSettingsSchema)) body: OwnerUpdateSettingsDto,
  ): Promise<PublicSettingsResponseDto> {
    if (!env.OWNER_SETTINGS_SECRET) {
      throw new ServiceUnavailableException('Owner settings endpoint is not configured')
    }
    if (!isValidAdminSecret(secret, env.OWNER_SETTINGS_SECRET)) {
      throw new ForbiddenException('Invalid owner settings credentials')
    }
    return this.ownerSettingsService.updateOwnerSettings(email ?? '', body)
  }
}
