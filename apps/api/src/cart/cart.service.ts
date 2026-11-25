import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import {
  allocateProportionalDiscount,
  type CartCouponResultDto,
  type CartTaxBreakdownDto,
  type CartValidatedLineDto,
  type CartValidateRequest,
  type CartValidateResponseDto,
  cartValidateResponseSchema,
  computeCouponDiscountPaise,
  computeGstBreakdownPaise,
  computePublicAvailability,
  COUPON_TYPE,
  type CouponType,
  formatPaiseToInr,
  formatPickupReadyEstimateIndia,
  FULFILMENT_METHOD,
  isCouponExpiredIndia,
  isFreeShippingWindowActive,
  isPlaceholderUrl,
  isProductionRuntime,
  type PincodeLookupResponseDto,
} from '@pressedoils/shared'
import { env } from '../env'
import { PincodeService } from '../pincode/pincode.service'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { CartRateLimitService } from './cart-rate-limit.service'

const INVALID_COUPON_MESSAGE = "This code isn't valid"

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly pincodeService: PincodeService,
    private readonly settingsService: SettingsService,
    private readonly cartRateLimitService: CartRateLimitService,
  ) {}

  private isProdRuntime(): boolean {
    return isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })
  }

  async validate(
    dto: CartValidateRequest,
    context: { ip: string; sessionId: string },
  ): Promise<CartValidateResponseDto> {
    const isProd = this.isProdRuntime()
    const maxOrderQty = env.MAX_QTY_PER_VARIANT
    const pricingSettings = await this.settingsService.getInternalPricingSettings()

    // Merge duplicate variantIds first so splitting qty across rows cannot bypass MAX_QTY_PER_VARIANT
    const mergedRequested = new Map<string, number>()
    for (const item of dto.items) {
      mergedRequested.set(item.variantId, (mergedRequested.get(item.variantId) ?? 0) + item.qty)
    }
    const requestedVariantIds = Array.from(mergedRequested.keys())

    const variantRows =
      requestedVariantIds.length === 0
        ? []
        : await this.prisma.variant.findMany({
            where: { id: { in: requestedVariantIds } },
            select: {
              id: true,
              sku: true,
              size_label: true,
              price_paise: true,
              mrp_paise: true,
              stock: true,
              reserved: true,
              low_stock_threshold: true,
              is_active: true,
              product: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  is_active: true,
                  images: {
                    orderBy: { sort_order: 'asc' },
                    take: 1,
                    select: { url: true, alt: true },
                  },
                },
              },
            },
          })

    const variantsById = new Map(variantRows.map((v) => [v.id, v]))

    let hasBlockingItemIssue = false
    const lineDrafts: Array<Omit<CartValidatedLineDto, 'lineDiscountPaise' | 'lineNetPaise'>> = []

    for (const [variantId, requestedQty] of mergedRequested.entries()) {
      const row = variantsById.get(variantId)
      const primaryImage = row?.product.images[0] ?? null
      const hasPlaceholderImage = row
        ? row.product.images.some((img) => isPlaceholderUrl(img.url))
        : false

      if (!row || !row.is_active || !row.product.is_active || (isProd && hasPlaceholderImage)) {
        if (isProd && hasPlaceholderImage && row) {
          this.logger.error({
            alert: 'PLACEHOLDER_PRODUCT_IN_PROD',
            slug: row.product.slug,
            productId: row.product.id,
            message: 'Blocked active product referencing /placeholders/ in cart validate',
          })
        }
        hasBlockingItemIssue = true
        lineDrafts.push({
          variantId,
          productId: row?.product.id ?? variantId,
          productSlug: row?.product.slug ?? 'unavailable',
          productName: row?.product.name ?? 'Unavailable oil',
          sizeLabel: row?.size_label ?? '—',
          sku: row?.sku ?? 'UNAVAILABLE',
          imageUrl: null,
          imageAlt: row?.product.name ?? 'Unavailable oil',
          requestedQty,
          effectiveQty: 0,
          unitPricePaise: 0,
          mrpPaise: null,
          lineSubtotalPaise: 0,
          inStock: false,
          lowStock: false,
          status: 'UNAVAILABLE',
          statusMessage: 'This oil is currently unavailable.',
        })
        continue
      }

      const clampedToMax = requestedQty > maxOrderQty
      const cappedQty = Math.min(maxOrderQty, requestedQty)
      const available = Math.max(0, row.stock - row.reserved)
      const availFlags = computePublicAvailability(row.stock, row.reserved, row.low_stock_threshold)

      if (available === 0) {
        hasBlockingItemIssue = true
        lineDrafts.push({
          variantId: row.id,
          productId: row.product.id,
          productSlug: row.product.slug,
          productName: row.product.name,
          sizeLabel: row.size_label,
          sku: row.sku,
          imageUrl: primaryImage?.url ?? null,
          imageAlt: primaryImage?.alt ?? row.product.name,
          requestedQty,
          effectiveQty: 0,
          unitPricePaise: row.price_paise,
          mrpPaise: row.mrp_paise,
          lineSubtotalPaise: 0,
          inStock: false,
          lowStock: false,
          status: 'OUT_OF_STOCK',
          statusMessage: 'Sold out',
        })
        continue
      }

      if (cappedQty > available) {
        if (available <= row.low_stock_threshold) {
          // Only reveal exact available count & auto-clamp when at or below threshold
          lineDrafts.push({
            variantId: row.id,
            productId: row.product.id,
            productSlug: row.product.slug,
            productName: row.product.name,
            sizeLabel: row.size_label,
            sku: row.sku,
            imageUrl: primaryImage?.url ?? null,
            imageAlt: primaryImage?.alt ?? row.product.name,
            requestedQty,
            effectiveQty: available,
            unitPricePaise: row.price_paise,
            mrpPaise: row.mrp_paise,
            lineSubtotalPaise: row.price_paise * available,
            inStock: true,
            lowStock: true,
            availableStock: available,
            status: 'ADJUSTED_QTY',
            statusMessage: `Only ${available} left`,
          })
        } else {
          // Above low-stock threshold: never expose exact stock number and never clamp silently
          hasBlockingItemIssue = true
          lineDrafts.push({
            variantId: row.id,
            productId: row.product.id,
            productSlug: row.product.slug,
            productName: row.product.name,
            sizeLabel: row.size_label,
            sku: row.sku,
            imageUrl: primaryImage?.url ?? null,
            imageAlt: primaryImage?.alt ?? row.product.name,
            requestedQty,
            effectiveQty: cappedQty,
            unitPricePaise: row.price_paise,
            mrpPaise: row.mrp_paise,
            lineSubtotalPaise: row.price_paise * cappedQty,
            inStock: true,
            lowStock: false,
            status: 'QUANTITY_UNAVAILABLE',
            statusMessage: "That quantity isn't available right now. Try a smaller amount.",
          })
        }
        continue
      }

      lineDrafts.push({
        variantId: row.id,
        productId: row.product.id,
        productSlug: row.product.slug,
        productName: row.product.name,
        sizeLabel: row.size_label,
        sku: row.sku,
        imageUrl: primaryImage?.url ?? null,
        imageAlt: primaryImage?.alt ?? row.product.name,
        requestedQty,
        effectiveQty: cappedQty,
        unitPricePaise: row.price_paise,
        mrpPaise: row.mrp_paise,
        lineSubtotalPaise: row.price_paise * cappedQty,
        inStock: availFlags.inStock,
        lowStock: availFlags.lowStock,
        ...(availFlags.availableStock !== undefined
          ? { availableStock: availFlags.availableStock }
          : {}),
        status: clampedToMax ? 'ADJUSTED_QTY' : 'OK',
        statusMessage: clampedToMax ? `Maximum ${maxOrderQty} per order` : null,
      })
    }

    const itemsSubtotalPaise = lineDrafts.reduce((sum, l) => sum + l.lineSubtotalPaise, 0)

    // Evaluate optional coupon strictly without mutating used_count in cart validate
    let couponResult: CartCouponResultDto | null = null
    let discountPaise = 0

    if (dto.couponCode && dto.couponCode.trim().length > 0) {
      const code = dto.couponCode.trim().toUpperCase()
      await this.cartRateLimitService.assertCouponCheckAllowed(context.ip, context.sessionId)

      const coupon = await this.prisma.coupon.findUnique({ where: { code } })
      const isInvalidOrInactive =
        !coupon ||
        !coupon.is_active ||
        isCouponExpiredIndia(coupon.expires_at) ||
        (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit)

      if (isInvalidOrInactive) {
        await this.cartRateLimitService.recordInvalidCouponAttempt(context.ip, context.sessionId)
        couponResult = {
          applied: false,
          code,
          discountPaise: 0,
          message: INVALID_COUPON_MESSAGE,
        }
      } else {
        const discountCalc = computeCouponDiscountPaise(itemsSubtotalPaise, {
          type: coupon.type as CouponType,
          value: coupon.value,
          minOrderPaise: coupon.min_order_paise,
          maxDiscountPaise: coupon.max_discount_paise,
        })

        if (!discountCalc.eligible) {
          couponResult = {
            applied: false,
            code: coupon.code,
            discountPaise: 0,
            message: `Minimum order of ${formatPaiseToInr(coupon.min_order_paise)} required for this code.`,
          }
        } else {
          discountPaise = discountCalc.discountPaise
          const savingsText =
            coupon.type === COUPON_TYPE.PERCENT && coupon.max_discount_paise === null
              ? `${coupon.value}% off applied (${formatPaiseToInr(discountPaise)} saved)`
              : `${formatPaiseToInr(discountPaise)} discount applied`
          couponResult = {
            applied: true,
            code: coupon.code,
            discountPaise,
            message: savingsText,
          }
        }
      }
    }

    // Proportionally allocate order-level coupon discount across active lines via largest remainder
    const lineDiscounts = allocateProportionalDiscount(
      lineDrafts.map((l) => l.lineSubtotalPaise),
      discountPaise,
    )

    const items: CartValidatedLineDto[] = lineDrafts.map((draft, idx) => {
      const lineDiscountPaise = lineDiscounts[idx] ?? 0
      return {
        ...draft,
        lineDiscountPaise,
        lineNetPaise: draft.lineSubtotalPaise - lineDiscountPaise,
      }
    })

    const netItemsTotalPaise = itemsSubtotalPaise - discountPaise

    // Fulfilment, store pickup & shipping rules
    let pickupPayload: CartValidateResponseDto['pickup'] = null
    let pincodePayload: PincodeLookupResponseDto | null = null
    let shippingPaise: number | null
    let shippingStatus: CartValidateResponseDto['summary']['shippingStatus']
    let freeShippingPayload: CartValidateResponseDto['freeShipping'] = null
    let pickupBlocked = false

    if (dto.fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP) {
      const eligibleLocations = pricingSettings.storePickupEnabled
        ? pricingSettings.pickupLocations
        : []

      if (eligibleLocations.length === 0) {
        throw new BadRequestException('Store pickup is not currently available')
      }

      const chosen =
        (dto.pickupLocationId
          ? eligibleLocations.find((l) => l.id === dto.pickupLocationId)
          : undefined) ?? eligibleLocations[0]!

      if (dto.pickupLocationId && !eligibleLocations.some((l) => l.id === dto.pickupLocationId)) {
        throw new BadRequestException('Selected pickup location is not available')
      }

      pickupPayload = {
        location: chosen,
        estimatedReadyDisplay: formatPickupReadyEstimateIndia(chosen.prepTimeMinutes),
      }
      shippingPaise = 0
      shippingStatus = 'PICKUP_FREE'
      freeShippingPayload = null
    } else {
      const freeShippingActive = isFreeShippingWindowActive({
        enabled: pricingSettings.freeShippingEnabledSetting,
        thresholdPaise: pricingSettings.freeShippingThresholdPaise,
        startsAt: pricingSettings.freeShippingStartsAt,
        endsAt: pricingSettings.freeShippingEndsAt,
      })

      if (freeShippingActive) {
        const thresholdPaise = pricingSettings.freeShippingThresholdPaise
        const qualified = netItemsTotalPaise >= thresholdPaise && netItemsTotalPaise > 0
        freeShippingPayload = {
          enabled: true,
          qualified,
          thresholdPaise,
          remainingPaise: Math.max(0, thresholdPaise - netItemsTotalPaise),
        }
      }

      if (dto.pincode) {
        pincodePayload = await this.pincodeService.check(dto.pincode)
        if (!pincodePayload.serviceable) {
          shippingPaise = null
          shippingStatus = 'UNSERVICEABLE'
          pickupBlocked = true
        } else {
          shippingPaise = freeShippingPayload?.qualified
            ? 0
            : (pincodePayload.shippingPaise ?? pricingSettings.defaultShippingPaise)
          shippingStatus = 'CALCULATED'
        }
      } else {
        shippingPaise = null
        shippingStatus = 'ENTER_PINCODE'
      }
    }

    const gst = computeGstBreakdownPaise(
      netItemsTotalPaise,
      pricingSettings.gstRateBps,
      pricingSettings.gstIncludedInPrice,
    )

    const taxPayload: CartTaxBreakdownDto = pricingSettings.showTaxBreakdown
      ? {
          showTaxBreakdown: true,
          rateBps: pricingSettings.gstRateBps,
          includedInPrice: pricingSettings.gstIncludedInPrice,
          taxPaise: gst.taxPaise,
        }
      : { showTaxBreakdown: false }

    const taxAddedPaise = pricingSettings.showTaxBreakdown ? gst.addedTaxPaise : 0
    const shippingKnown = shippingStatus === 'CALCULATED' || shippingStatus === 'PICKUP_FREE'
    const totalLabel = shippingKnown ? 'Total' : 'Items total'
    const totalPaise = netItemsTotalPaise + (shippingPaise ?? 0) + taxAddedPaise

    const hasValidItems = items.some((i) => i.effectiveQty > 0)
    const canCheckout = hasValidItems && !hasBlockingItemIssue && !pickupBlocked && shippingKnown

    return cartValidateResponseSchema.parse({
      items,
      fulfilmentMethod: dto.fulfilmentMethod,
      pickup: pickupPayload,
      pincode: pincodePayload,
      coupon: couponResult,
      freeShipping: freeShippingPayload,
      tax: taxPayload,
      summary: {
        itemsSubtotalPaise,
        discountPaise,
        netItemsTotalPaise,
        shippingPaise,
        shippingStatus,
        taxAddedPaise,
        totalPaise,
        totalLabel,
        canCheckout,
      },
      maxOrderQtyPerVariant: maxOrderQty,
    })
  }
}
