import { Body, Controller, Headers, Patch, UseGuards } from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import {
  ownerUpdateSettingsSchema,
  type OwnerUpdateSettingsDto,
  type PublicSettingsResponseDto,
} from '@pressedoils/shared'
import { TempAdminGuard } from '../common/temp-admin.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { OwnerSettingsService } from './owner-settings.service'

@ApiTags('admin-settings')
@Controller('admin/settings')
@UseGuards(TempAdminGuard)
export class AdminSettingsController {
  constructor(private readonly ownerSettingsService: OwnerSettingsService) {}

  @Patch()
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Owner-only dev/staging settings switch (disabled in production until Phase 9 Admin 2FA)',
  })
  @ApiHeader({ name: 'x-admin-secret', required: true })
  @ApiHeader({ name: 'x-admin-email', required: true })
  @ApiResponse({ status: 200, description: 'Updated public settings snapshot (audit logged)' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden: disabled in production, invalid secret, or non-OWNER admin',
  })
  async updateSettings(
    @Headers('x-admin-email') email: string | undefined,
    @Body(new ZodValidationPipe(ownerUpdateSettingsSchema)) body: OwnerUpdateSettingsDto,
  ): Promise<PublicSettingsResponseDto> {
    return this.ownerSettingsService.updateOwnerSettings(email ?? '', body)
  }
}
