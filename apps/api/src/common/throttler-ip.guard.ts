import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { Request } from 'express'
import { getRealClientIp } from './client-ip'

@Injectable()
export class ThrottlerIpGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return getRealClientIp(req as unknown as Request)
  }
}
