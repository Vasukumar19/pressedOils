import { Injectable } from '@nestjs/common'
import type { PincodeLookupResponseDto } from '@pressedoils/shared'
import { SingleFlight, withJitter } from '../common/single-flight'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'

const PINCODE_CACHE_TTL_SECONDS = 600

@Injectable()
export class PincodeService {
  private readonly singleFlight = new SingleFlight()

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(pincode: string): Promise<PincodeLookupResponseDto> {
    const cacheKey = `pincode:v1:${pincode}`
    const cached = await this.redis.getJson<PincodeLookupResponseDto>(cacheKey)
    if (cached !== null) return cached

    return this.singleFlight.run(cacheKey, async () => {
      const row = await this.prisma.serviceablePincode.findFirst({
        where: { pincode, is_active: true },
        select: {
          pincode: true,
          city: true,
          state: true,
          delivery_days: true,
          cod_allowed: true,
          shipping_paise: true,
        },
      })

      const result: PincodeLookupResponseDto = row
        ? {
            pincode: row.pincode,
            serviceable: true,
            city: row.city,
            state: row.state,
            deliveryDays: row.delivery_days,
            codAllowed: row.cod_allowed,
            shippingPaise: row.shipping_paise,
          }
        : {
            pincode,
            serviceable: false,
            city: null,
            state: null,
            deliveryDays: null,
            codAllowed: false,
            shippingPaise: null,
          }

      await this.redis.setJson(cacheKey, result, withJitter(PINCODE_CACHE_TTL_SECONDS, 0.2))
      return result
    })
  }
}
