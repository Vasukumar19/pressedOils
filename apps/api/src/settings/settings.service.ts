import { Injectable } from '@nestjs/common'
import {
  CURRENCY,
  type PublicSettingsResponseDto,
  SETTING_KEYS,
  shouldShowSampleDataBanner,
} from '@pressedoils/shared'
import { SingleFlight, withJitter } from '../common/single-flight'
import { env } from '../env'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'

const SETTINGS_CACHE_KEY = 'settings:public:v1'
const SETTINGS_CACHE_TTL_SECONDS = 300

const PUBLIC_SETTING_KEY_LIST = [
  SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE,
  SETTING_KEYS.DEFAULT_SHIPPING_PAISE,
  SETTING_KEYS.GST_CONFIG,
  SETTING_KEYS.STORE_INFO,
  SETTING_KEYS.REQUIRE_LAB_REPORT_FOR_ACTIVATION,
]

@Injectable()
export class SettingsService {
  private readonly singleFlight = new SingleFlight()

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getPublicSettings(): Promise<PublicSettingsResponseDto> {
    const cached =
      await this.redis.getJson<Omit<PublicSettingsResponseDto, 'showSampleDataBanner'>>(
        SETTINGS_CACHE_KEY,
      )

    const base =
      cached ??
      (await this.singleFlight.run(SETTINGS_CACHE_KEY, async () => {
        const rows = await this.prisma.setting.findMany({
          where: { key: { in: PUBLIC_SETTING_KEY_LIST } },
          select: { key: true, value: true },
        })

        const byKey = new Map(rows.map((r) => [r.key, r.value as Record<string, unknown>]))
        const threshold = byKey.get(SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE)
        const shipping = byKey.get(SETTING_KEYS.DEFAULT_SHIPPING_PAISE)
        const gst = byKey.get(SETTING_KEYS.GST_CONFIG)
        const store = byKey.get(SETTING_KEYS.STORE_INFO)
        const labReq = byKey.get(SETTING_KEYS.REQUIRE_LAB_REPORT_FOR_ACTIVATION)

        const mapped = {
          brandName: typeof store?.brandName === 'string' ? store.brandName : '[YOUR BRAND]',
          currency: CURRENCY,
          freeShippingThresholdPaise:
            typeof threshold?.amountPaise === 'number' ? threshold.amountPaise : 99900,
          defaultShippingPaise:
            typeof shipping?.amountPaise === 'number' ? shipping.amountPaise : 7000,
          gstRateBps: typeof gst?.rateBps === 'number' ? gst.rateBps : 500,
          gstIncludedInPrice:
            typeof gst?.includedInPrice === 'boolean' ? gst.includedInPrice : true,
          fssaiNumber: typeof store?.fssaiNumber === 'string' ? store.fssaiNumber : 'TODO(owner)',
          supportEmail:
            typeof store?.supportEmail === 'string' ? store.supportEmail : 'TODO(owner)',
          supportPhone:
            typeof store?.supportPhone === 'string' ? store.supportPhone : 'TODO(owner)',
          registeredAddress:
            typeof store?.registeredAddress === 'string' ? store.registeredAddress : 'TODO(owner)',
          maxQtyPerVariant: env.MAX_QTY_PER_VARIANT,
          requireLabReportForActivation:
            typeof labReq?.enabled === 'boolean' ? labReq.enabled : true,
        }

        await this.redis.setJson(
          SETTINGS_CACHE_KEY,
          mapped,
          withJitter(SETTINGS_CACHE_TTL_SECONDS, 0.2),
        )
        return mapped
      }))

    return {
      ...base,
      showSampleDataBanner: shouldShowSampleDataBanner({
        APP_ENV: env.APP_ENV,
        IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
        SHOW_SAMPLE_DATA_BANNER: env.SHOW_SAMPLE_DATA_BANNER,
      }),
    }
  }
}
