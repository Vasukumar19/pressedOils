import { Controller, Get, HttpStatus, Res } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { HealthLivenessResponseDto, HealthReadinessResponseDto } from '@pressedoils/shared'
import type { Response } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe — confirms the API process is running' })
  @ApiResponse({ status: 200, description: 'API process is alive' })
  checkLiveness(): HealthLivenessResponseDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe — depends on PostgreSQL only; reports Redis degraded with HTTP 200',
  })
  @ApiResponse({ status: 200, description: 'Database is reachable (Redis may be ok or degraded)' })
  @ApiResponse({ status: 503, description: 'Database is unreachable' })
  async checkReadiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReadinessResponseDto> {
    let database: 'ok' | 'down' = 'ok'
    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch {
      database = 'down'
    }

    const redis = await this.redis.ping()
    const status = database === 'down' ? 'down' : redis === 'degraded' ? 'degraded' : 'ok'

    res.status(database === 'down' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK)
    return {
      status,
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    }
  }
}
