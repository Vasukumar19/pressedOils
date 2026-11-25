import { Injectable } from '@nestjs/common'
import {
  CURRENCY,
  isFreeShippingWindowActive,
  isProductionRuntime,
  type PickupLocationPublicDto,
  type PublicSettingsResponseDto,
  SETTING_KEYS,
  shouldShowSampleDataBanner,
} from '@pressedoils/shared'
import { SingleFlight, withJitter } from '../common/single-flight'
import { env } from '../env'
import { PrismaService } from '../prisma/prisma.service'
import { RedisService } from '../redis/redis.service'

const SETTINGS_CACHE_KEY = 'settings:public:v5'
const SETTINGS_CACHE_TTL_SECONDS = 5

const PUBLIC_SETTING_KEY_LIST = [
  SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE,
  SETTING_KEYS.FREE_SHIPPING_CONFIG,
  SETTING_KEYS.DEFAULT_SHIPPING_PAISE,
  SETTING_KEYS.GST_CONFIG,
  SETTING_KEYS.TAX_DISPLAY_CONFIG,
  SETTING_KEYS.STORE_PICKUP_CONFIG,
  SETTING_KEYS.COD_CONFIG,
  SETTING_KEYS.LEGAL_PAGES_CONFIG,
  SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS,
  SETTING_KEYS.STORE_INFO,
  SETTING_KEYS.REQUIRE_LAB_REPORT_FOR_ACTIVATION,
]

export interface InternalPricingSettings {
  brandName: string
  freeShippingEnabledSetting: boolean
  freeShippingThresholdPaise: number
  freeShippingStartsAt: string | null
  freeShippingEndsAt: string | null
  defaultShippingPaise: number
  gstRateBps: number
  gstIncludedInPrice: boolean
  shippingTaxRateBps: number | null
  showTaxBreakdown: boolean
  storePickupEnabled: boolean
  payAtStoreEnabled: boolean
  holdWindowDays: number
  codEnabled: boolean
  codFeePaise: number
  codMaxOrderPaise: number
  maxActiveCodOrdersPerPhone: number
  legalPagesApproved: boolean
  dpdpPolicyVersion: string
  autoConfirmPaidOrders: boolean
  fssaiNumber: string
  supportEmail: string
  supportPhone: string
  registeredAddress: string
  requireLabReportForActivation: boolean
  pickupLocations: PickupLocationPublicDto[]
}

@Injectable()
export class SettingsService {
  private readonly singleFlight = new SingleFlight()

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  isProdRuntime(): boolean {
    return isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })
  }

  isSmsOtpReady(): boolean {
    const isProd = this.isProdRuntime()
    if (!isProd) {
      if (env.SMS_PROVIDER === 'mock') return true
    }
    return Boolean(
      env.SMS_PROVIDER === 'msg91' &&
      env.MSG91_AUTH_KEY &&
      env.MSG91_SENDER_ID &&
      env.MSG91_DLT_TEMPLATE_OTP,
    )
  }

  async invalidateCache(): Promise<void> {
    await this.redis.del(SETTINGS_CACHE_KEY)
  }

  async getInternalPricingSettings(): Promise<InternalPricingSettings> {
    const isProd = this.isProdRuntime()
    const cached = await this.redis.getJson<InternalPricingSettings>(SETTINGS_CACHE_KEY)

    const resolved =
      cached ??
      (await this.singleFlight.run(SETTINGS_CACHE_KEY, async () => {
        const [rows, pickupRows] = await Promise.all([
          this.prisma.setting.findMany({
            where: { key: { in: PUBLIC_SETTING_KEY_LIST } },
            select: { key: true, value: true },
          }),
          this.prisma.pickupLocation.findMany({
            where: {
              is_active: true,
              ...(isProd ? { is_sample: false } : {}),
            },
            orderBy: [{ is_sample: 'asc' }, { created_at: 'asc' }],
            select: {
              id: true,
              name: true,
              address: true,
              hours: true,
              prep_time_minutes: true,
              is_sample: true,
            },
          }),
        ])

        const byKey = new Map(rows.map((r) => [r.key, r.value as Record<string, unknown>]))
        const legacyThreshold = byKey.get(SETTING_KEYS.FREE_SHIPPING_THRESHOLD_PAISE)
        const freeShipCfg = byKey.get(SETTING_KEYS.FREE_SHIPPING_CONFIG)
        const shipping = byKey.get(SETTING_KEYS.DEFAULT_SHIPPING_PAISE)
        const gst = byKey.get(SETTING_KEYS.GST_CONFIG)
        const taxDisplay = byKey.get(SETTING_KEYS.TAX_DISPLAY_CONFIG)
        const storePickup = byKey.get(SETTING_KEYS.STORE_PICKUP_CONFIG)
        const codCfg = byKey.get(SETTING_KEYS.COD_CONFIG)
        const legalCfg = byKey.get(SETTING_KEYS.LEGAL_PAGES_CONFIG)
        const autoConfirmCfg = byKey.get(SETTING_KEYS.AUTO_CONFIRM_PAID_ORDERS)
        const store = byKey.get(SETTING_KEYS.STORE_INFO)
        const labReq = byKey.get(SETTING_KEYS.REQUIRE_LAB_REPORT_FOR_ACTIVATION)

        const freeShippingThresholdPaise =
          typeof freeShipCfg?.thresholdPaise === 'number'
            ? freeShipCfg.thresholdPaise
            : typeof legacyThreshold?.amountPaise === 'number'
              ? legacyThreshold.amountPaise
              : 99900

        const pickupLocations: PickupLocationPublicDto[] = pickupRows.map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          hours: p.hours,
          prepTimeMinutes: p.prep_time_minutes,
          isSample: p.is_sample,
        }))

        const mapped: InternalPricingSettings = {
          brandName: typeof store?.brandName === 'string' ? store.brandName : '[YOUR BRAND]',
          freeShippingEnabledSetting:
            typeof freeShipCfg?.enabled === 'boolean' ? freeShipCfg.enabled : false,
          freeShippingThresholdPaise,
          freeShippingStartsAt:
            typeof freeShipCfg?.startsAt === 'string' ? freeShipCfg.startsAt : null,
          freeShippingEndsAt: typeof freeShipCfg?.endsAt === 'string' ? freeShipCfg.endsAt : null,
          defaultShippingPaise:
            typeof shipping?.amountPaise === 'number' ? shipping.amountPaise : 7000,
          gstRateBps: typeof gst?.rateBps === 'number' ? gst.rateBps : 500,
          gstIncludedInPrice:
            typeof gst?.includedInPrice === 'boolean' ? gst.includedInPrice : true,
          shippingTaxRateBps:
            typeof gst?.shippingTaxRateBps === 'number' ? gst.shippingTaxRateBps : null,
          showTaxBreakdown:
            typeof taxDisplay?.showTaxBreakdown === 'boolean' ? taxDisplay.showTaxBreakdown : false,
          storePickupEnabled:
            typeof storePickup?.enabled === 'boolean' ? storePickup.enabled : false,
          payAtStoreEnabled:
            typeof storePickup?.payAtStoreEnabled === 'boolean'
              ? storePickup.payAtStoreEnabled
              : false,
          holdWindowDays:
            typeof storePickup?.holdWindowDays === 'number' ? storePickup.holdWindowDays : 3,
          codEnabled: typeof codCfg?.enabled === 'boolean' ? codCfg.enabled : false,
          codFeePaise: typeof codCfg?.feePaise === 'number' ? codCfg.feePaise : 0,
          codMaxOrderPaise:
            typeof codCfg?.maxOrderPaise === 'number' ? codCfg.maxOrderPaise : 500000,
          maxActiveCodOrdersPerPhone:
            typeof codCfg?.maxActiveOrdersPerPhone === 'number'
              ? codCfg.maxActiveOrdersPerPhone
              : 2,
          legalPagesApproved: typeof legalCfg?.approved === 'boolean' ? legalCfg.approved : false,
          dpdpPolicyVersion:
            typeof legalCfg?.privacyVersion === 'string'
              ? legalCfg.privacyVersion
              : env.LEGAL_PRIVACY_VERSION,
          autoConfirmPaidOrders:
            typeof autoConfirmCfg?.enabled === 'boolean' ? autoConfirmCfg.enabled : true,
          fssaiNumber: typeof store?.fssaiNumber === 'string' ? store.fssaiNumber : 'TODO(owner)',
          supportEmail:
            typeof store?.supportEmail === 'string' ? store.supportEmail : 'TODO(owner)',
          supportPhone:
            typeof store?.supportPhone === 'string' ? store.supportPhone : 'TODO(owner)',
          registeredAddress:
            typeof store?.registeredAddress === 'string' ? store.registeredAddress : 'TODO(owner)',
          requireLabReportForActivation:
            typeof labReq?.enabled === 'boolean' ? labReq.enabled : true,
          pickupLocations,
        }

        await this.redis.setJson(
          SETTINGS_CACHE_KEY,
          mapped,
          withJitter(SETTINGS_CACHE_TTL_SECONDS, 0.2),
        )
        return mapped
      }))

    if (!isProd) return resolved
    // Defensive production guard even on cached payload: never expose sample pickup locations
    return {
      ...resolved,
      pickupLocations: resolved.pickupLocations.filter((loc) => !loc.isSample),
    }
  }

  async getPublicSettings(): Promise<PublicSettingsResponseDto> {
    const isProd = this.isProdRuntime()
    const internal = await this.getInternalPricingSettings()
    const freeShippingActive = isFreeShippingWindowActive({
      enabled: internal.freeShippingEnabledSetting,
      thresholdPaise: internal.freeShippingThresholdPaise,
      startsAt: internal.freeShippingStartsAt,
      endsAt: internal.freeShippingEndsAt,
    })

    const eligibleLocations = internal.storePickupEnabled ? internal.pickupLocations : []
    const storePickupAvailable = internal.storePickupEnabled && eligibleLocations.length > 0
    const smsOtpReady = this.isSmsOtpReady()
    const effectiveCodEnabled = isProd
      ? internal.codEnabled && smsOtpReady
      : internal.codEnabled && smsOtpReady
    const effectivePayAtStoreEnabled =
      storePickupAvailable && internal.payAtStoreEnabled && smsOtpReady
    const checkoutEnabled = isProd ? internal.legalPagesApproved : true

    return {
      brandName: internal.brandName,
      currency: CURRENCY,
      freeShippingEnabled: freeShippingActive,
      freeShippingThresholdPaise: freeShippingActive ? internal.freeShippingThresholdPaise : null,
      defaultShippingPaise: internal.defaultShippingPaise,
      gstRateBps: internal.gstRateBps,
      gstIncludedInPrice: internal.gstIncludedInPrice,
      showTaxBreakdown: internal.showTaxBreakdown,
      storePickupEnabled: storePickupAvailable,
      payAtStoreEnabled: effectivePayAtStoreEnabled,
      pickupLocations: storePickupAvailable ? eligibleLocations : [],
      codEnabled: effectiveCodEnabled,
      codFeePaise: internal.codFeePaise,
      codMaxOrderPaise: effectiveCodEnabled ? internal.codMaxOrderPaise : null,
      legalPagesApproved: internal.legalPagesApproved,
      dpdpPolicyVersion: internal.dpdpPolicyVersion,
      autoConfirmPaidOrders: internal.autoConfirmPaidOrders,
      smsOtpReady,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      checkoutEnabled,
      paymentGateway: isProd ? 'razorpay' : env.PAYMENT_GATEWAY,
      fssaiNumber: internal.fssaiNumber,
      supportEmail: internal.supportEmail,
      supportPhone: internal.supportPhone,
      registeredAddress: internal.registeredAddress,
      maxQtyPerVariant: env.MAX_QTY_PER_VARIANT,
      requireLabReportForActivation: internal.requireLabReportForActivation,
      showSampleDataBanner: shouldShowSampleDataBanner({
        APP_ENV: env.APP_ENV,
        IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
        SHOW_SAMPLE_DATA_BANNER: env.SHOW_SAMPLE_DATA_BANNER,
      }),
    }
  }
}
