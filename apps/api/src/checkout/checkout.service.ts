import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import {
  CouponType as PrismaCouponType,
  FulfilmentMethod as PrismaFulfilmentMethod,
  OrderStatus as PrismaOrderStatus,
  PaymentMethod as PrismaPaymentMethod,
  PaymentStatus as PrismaPaymentStatus,
  Prisma,
  ReservationStatus as PrismaReservationStatus,
} from '@prisma/client'
import {
  allocateProportionalDiscount,
  canTransitionOrderStatus,
  type CartTaxBreakdownDto,
  type CheckoutFailRequest,
  type CheckoutFailResponseDto,
  checkoutFailResponseSchema,
  type CheckoutOrderSummaryDto,
  type CheckoutRequest,
  type CheckoutResponseDto,
  checkoutResponseSchema,
  type CheckoutVerifyRequest,
  type CheckoutVerifyResponseDto,
  checkoutVerifyResponseSchema,
  computeCouponDiscountPaise,
  computeGstBreakdownPaise,
  type CouponType,
  formatPaiseToInr,
  formatPickupReadyEstimateIndia,
  FULFILMENT_METHOD,
  IDEMPOTENCY_TTL_HOURS,
  isCouponExpiredIndia,
  isFreeShippingWindowActive,
  isPlaceholderUrl,
  isProductionRuntime,
  ORDER_STATUS,
  type OrderStatus,
  PAYMENT_METHOD,
  type PaymentStatus,
  PICKUP_CODE_MAX_ATTEMPTS,
  RESERVATION_GRACE_MINUTES,
  RESERVATION_TTL_MINUTES,
  STOCK_MOVEMENT_REASON,
} from '@pressedoils/shared'
import { CartRateLimitService } from '../cart/cart-rate-limit.service'
import { SingleFlight } from '../common/single-flight'
import { env } from '../env'
import { PincodeService } from '../pincode/pincode.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProductCacheService } from '../products/products.cache'
import { RedisService } from '../redis/redis.service'
import { SettingsService } from '../settings/settings.service'
import { CheckoutSecurityService } from './checkout-security.service'
import { PaymentGatewayService } from './payment-gateway.service'

const ACTIVE_COD_ORDER_STATUSES: PrismaOrderStatus[] = [
  PrismaOrderStatus.COD_PENDING,
  PrismaOrderStatus.CONFIRMED,
  PrismaOrderStatus.PACKED,
  PrismaOrderStatus.SHIPPED,
  PrismaOrderStatus.READY_FOR_PICKUP,
]

const ALREADY_PAID_STATUSES = new Set<string>([
  ORDER_STATUS.PAID,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PACKED,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.READY_FOR_PICKUP,
  ORDER_STATUS.PICKED_UP,
])

const INVALID_COUPON_MESSAGE = "This code isn't valid"
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{16,128}$/
const EXPIRY_SWEEP_INTERVAL_MS = 60_000

interface LockedVariantRow {
  id: string
  product_id: string
  sku: string
  size_label: string
  price_paise: number
  mrp_paise: number | null
  stock: number
  reserved: number
  low_stock_threshold: number
  v_active: boolean
  product_slug: string
  product_name: string
  p_active: boolean
}

export interface MarkOrderPaidInput {
  orderId?: string
  gatewayOrderId: string
  gatewayPaymentId: string
  rawPayload?: unknown
  source: 'verify' | 'webhook' | 'reconcile'
}

export interface MarkOrderPaidOutcome {
  order: CheckoutOrderSummaryDto
  alreadyProcessed: boolean
  autoRefunded: boolean
  refundSucceeded: boolean
  message: string
}

@Injectable()
export class CheckoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckoutService.name)
  private readonly idempotencySingleFlight = new SingleFlight()
  private sweepTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly pincodeService: PincodeService,
    private readonly settingsService: SettingsService,
    private readonly productCacheService: ProductCacheService,
    private readonly cartRateLimitService: CartRateLimitService,
    private readonly checkoutSecurity: CheckoutSecurityService,
    private readonly paymentGateway: PaymentGatewayService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    if (env.NODE_ENV === 'test') return
    this.sweepTimer = setInterval(() => {
      void this.runScheduledExpirySweep()
    }, EXPIRY_SWEEP_INTERVAL_MS)
    this.sweepTimer.unref()
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  private async runScheduledExpirySweep(): Promise<void> {
    const lockKey = 'checkout:expiry-sweep-lock'
    const acquired = await this.redis.setStringNx(lockKey, '1', 50)
    if (acquired === false) return
    try {
      await this.releaseExpiredReservations()
    } catch (error) {
      this.logger.error({
        event: 'RESERVATION_EXPIRY_SWEEP_ERROR',
        error: error instanceof Error ? error.message : 'unknown sweep error',
      })
    }
  }

  private isProdRuntime(): boolean {
    return isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })
  }

  async createOrder(
    dto: CheckoutRequest,
    idempotencyKeyHeader: string | undefined,
    context: { ip: string; sessionId: string },
  ): Promise<CheckoutResponseDto> {
    const idempotencyKey = idempotencyKeyHeader?.trim()
    if (!idempotencyKey || !IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
      throw new BadRequestException(
        'A valid Idempotency-Key header (16-128 alphanumeric/hyphen characters) is required',
      )
    }

    const requestHash = this.checkoutSecurity.computeCheckoutRequestHash(dto)
    return this.idempotencySingleFlight.run(`checkout-idemp:${idempotencyKey}`, () =>
      this.executeCreateOrder(dto, idempotencyKey, requestHash, context),
    )
  }

  private async executeCreateOrder(
    dto: CheckoutRequest,
    idempotencyKey: string,
    requestHash: string,
    context: { ip: string; sessionId: string },
  ): Promise<CheckoutResponseDto> {
    const now = new Date()

    const existingIdemp = await this.prisma.checkoutIdempotencyKey.findUnique({
      where: { key: idempotencyKey },
    })
    if (existingIdemp && existingIdemp.expires_at > now) {
      if (existingIdemp.request_hash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key was already used with a different checkout request payload',
        )
      }
      if (existingIdemp.status_code === 201) {
        return checkoutResponseSchema.parse(existingIdemp.response_json)
      }
      throw new ConflictException('Another checkout request with this Idempotency-Key is active')
    }

    const isProd = this.isProdRuntime()
    const pricingSettings = await this.settingsService.getInternalPricingSettings()

    if (isProd && !pricingSettings.legalPagesApproved) {
      throw new ForbiddenException(
        'Checkout is currently disabled until store legal policies are approved',
      )
    }

    // Validate fulfilment & payment method rules
    let resolvedPickupLocation: (typeof pricingSettings.pickupLocations)[number] | null = null
    let shippingPaise = 0

    if (dto.fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP) {
      const eligibleLocations = pricingSettings.storePickupEnabled
        ? pricingSettings.pickupLocations
        : []
      if (eligibleLocations.length === 0) {
        throw new BadRequestException('Store pickup is not currently available')
      }
      const selected = dto.pickupLocationId
        ? eligibleLocations.find((l) => l.id === dto.pickupLocationId)
        : eligibleLocations[0]
      if (!selected) {
        throw new BadRequestException('Selected pickup location is not available')
      }
      if (isProd && selected.isSample) {
        throw new BadRequestException('Sample pickup locations cannot be used in production')
      }
      resolvedPickupLocation = selected

      if (dto.paymentMethod === PAYMENT_METHOD.COD) {
        if (!pricingSettings.payAtStoreEnabled || (isProd && !pricingSettings.codEnabled)) {
          throw new BadRequestException('Pay at store is not enabled')
        }
      }
    } else {
      const address = dto.address
      if (!address) {
        throw new BadRequestException('Delivery address is required')
      }
      const pincodeCheck = await this.pincodeService.check(address.pincode)
      if (!pincodeCheck.serviceable) {
        throw new BadRequestException(`Sorry, delivery is not serviceable for ${address.pincode}.`)
      }
      if (dto.paymentMethod === PAYMENT_METHOD.COD) {
        if (!pricingSettings.codEnabled) {
          throw new BadRequestException('Cash on Delivery is currently disabled')
        }
        if (!pincodeCheck.codAllowed) {
          throw new BadRequestException(
            `Cash on Delivery is not available for pincode ${address.pincode}.`,
          )
        }
      }
      shippingPaise = pincodeCheck.shippingPaise ?? pricingSettings.defaultShippingPaise
    }

    // Merge duplicate variantIds strictly
    const mergedRequested = new Map<string, number>()
    for (const item of dto.items) {
      mergedRequested.set(item.variantId, (mergedRequested.get(item.variantId) ?? 0) + item.qty)
    }
    const sortedVariantIds = Array.from(mergedRequested.keys()).sort()
    const maxOrderQty = env.MAX_QTY_PER_VARIANT
    for (const qty of mergedRequested.values()) {
      if (qty > maxOrderQty) {
        throw new BadRequestException(`Maximum ${maxOrderQty} per bottle size per order`)
      }
    }

    if (dto.couponCode && dto.couponCode.trim().length > 0) {
      await this.cartRateLimitService.assertCouponCheckAllowed(context.ip, context.sessionId)
    }

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60_000)
    const idempotencyExpiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 3_600_000)

    let txOutcome:
      | { kind: 'REPLAY'; response: CheckoutResponseDto }
      | {
          kind: 'CREATED'
          orderId: string
          orderSummary: CheckoutOrderSummaryDto
          variantIds: string[]
        }
      | null = null

    let invalidCouponAttempt = false

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        txOutcome = await this.prisma.$transaction(async (tx) => {
          // Serialize duplicate Idempotency-Key execution inside DB
          const lockedKeys = await tx.$queryRaw<
            Array<{
              key: string
              request_hash: string
              status_code: number
              response_json: Prisma.JsonValue
              expires_at: Date
            }>
          >`SELECT key, request_hash, status_code, response_json, expires_at FROM checkout_idempotency_keys WHERE key = ${idempotencyKey} FOR UPDATE`

          const lockedKey = lockedKeys[0]
          if (lockedKey) {
            if (lockedKey.expires_at > new Date()) {
              if (lockedKey.request_hash !== requestHash) {
                throw new ConflictException(
                  'Idempotency-Key was already used with a different checkout request payload',
                )
              }
              if (lockedKey.status_code === 201) {
                return {
                  kind: 'REPLAY' as const,
                  response: checkoutResponseSchema.parse(lockedKey.response_json),
                }
              }
              throw new ConflictException(
                'Another checkout request with this Idempotency-Key is in progress',
              )
            }
            await tx.checkoutIdempotencyKey.delete({ where: { key: idempotencyKey } })
          }

          // Lock all variant rows in deterministic sorted UUID order to prevent deadlocks
          const lockedVariants = await tx.$queryRaw<LockedVariantRow[]>`
            SELECT
              v.id,
              v.product_id,
              v.sku,
              v.size_label,
              v.price_paise,
              v.mrp_paise,
              v.stock,
              v.reserved,
              v.low_stock_threshold,
              v.is_active AS v_active,
              p.slug AS product_slug,
              p.name AS product_name,
              p.is_active AS p_active
            FROM variants v
            INNER JOIN products p ON p.id = v.product_id
            WHERE v.id = ANY(${sortedVariantIds}::text[])
            ORDER BY v.id ASC
            FOR UPDATE OF v
          `

          const variantsById = new Map(lockedVariants.map((row) => [row.id, row]))
          if (variantsById.size !== sortedVariantIds.length) {
            throw new BadRequestException('One or more selected products are unavailable')
          }

          if (isProd) {
            const productIds = Array.from(new Set(lockedVariants.map((v) => v.product_id)))
            const images = await tx.productImage.findMany({
              where: { product_id: { in: productIds } },
              select: { url: true },
            })
            if (images.some((img) => isPlaceholderUrl(img.url))) {
              throw new BadRequestException('Placeholder products cannot be ordered in production')
            }
          }

          // Validate stock sufficiency without revealing exact counts above threshold
          for (const variantId of sortedVariantIds) {
            const row = variantsById.get(variantId)!
            const qty = mergedRequested.get(variantId)!
            if (!row.v_active || !row.p_active) {
              throw new BadRequestException(
                `${row.product_name} (${row.size_label}) is unavailable`,
              )
            }
            const available = Math.max(0, row.stock - row.reserved)
            if (available < qty) {
              if (available === 0) {
                throw new ConflictException(`${row.product_name} (${row.size_label}) is sold out.`)
              }
              if (available <= row.low_stock_threshold) {
                throw new ConflictException(
                  `Only ${available} left for ${row.product_name} (${row.size_label}). Please adjust quantity.`,
                )
              }
              throw new ConflictException(
                `Requested quantity for ${row.product_name} (${row.size_label}) isn't available right now. Try a smaller amount.`,
              )
            }
          }

          // Serialize concurrent orders for same phone by upserting & locking Customer row
          const customerIdSeed = randomUUID()
          const customerRows = await tx.$queryRaw<Array<{ id: string }>>`
            INSERT INTO customers (id, name, phone, email, created_at, updated_at)
            VALUES (
              ${customerIdSeed},
              ${dto.contact.name.trim()},
              ${dto.contact.phone},
              ${dto.contact.email?.trim().toLowerCase() ?? null},
              NOW(),
              NOW()
            )
            ON CONFLICT (phone) DO UPDATE SET
              name = EXCLUDED.name,
              email = COALESCE(EXCLUDED.email, customers.email),
              updated_at = NOW()
            RETURNING id
          `
          const customerId = customerRows[0]!.id

          if (dto.paymentMethod === PAYMENT_METHOD.COD) {
            const activeCodCount = await tx.order.count({
              where: {
                customer_id: customerId,
                payment_method: PrismaPaymentMethod.COD,
                order_status: { in: ACTIVE_COD_ORDER_STATUSES },
              },
            })
            if (activeCodCount >= pricingSettings.maxActiveCodOrdersPerPhone) {
              throw new BadRequestException(
                `You already have ${activeCodCount} active Cash on Delivery orders. Please complete or pay online for this order.`,
              )
            }
          }

          // Compute line subtotals strictly in integer paise from locked DB rows
          const orderedLines = sortedVariantIds.map((variantId) => {
            const row = variantsById.get(variantId)!
            const qty = mergedRequested.get(variantId)!
            return {
              variant: row,
              qty,
              lineSubtotalPaise: row.price_paise * qty,
            }
          })
          const itemsSubtotalPaise = orderedLines.reduce((sum, l) => sum + l.lineSubtotalPaise, 0)

          // Coupon validation & atomic single-slot increment inside checkout tx
          let appliedCouponCode: string | null = null
          let discountPaise = 0

          if (dto.couponCode && dto.couponCode.trim().length > 0) {
            const code = dto.couponCode.trim().toUpperCase()
            const lockedCoupons = await tx.$queryRaw<
              Array<{
                id: string
                code: string
                type: PrismaCouponType
                value: number
                min_order_paise: number
                max_discount_paise: number | null
                expires_at: Date | null
                usage_limit: number | null
                used_count: number
                is_active: boolean
              }>
            >`SELECT id, code, type, value, min_order_paise, max_discount_paise, expires_at, usage_limit, used_count, is_active FROM coupons WHERE code = ${code} FOR UPDATE`

            const coupon = lockedCoupons[0]
            const couponInvalid =
              !coupon ||
              !coupon.is_active ||
              isCouponExpiredIndia(coupon.expires_at) ||
              (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit)

            if (couponInvalid) {
              invalidCouponAttempt = true
              throw new BadRequestException(INVALID_COUPON_MESSAGE)
            }

            const calc = computeCouponDiscountPaise(itemsSubtotalPaise, {
              type: coupon.type as CouponType,
              value: coupon.value,
              minOrderPaise: coupon.min_order_paise,
              maxDiscountPaise: coupon.max_discount_paise,
            })

            if (!calc.eligible) {
              throw new BadRequestException(
                `Minimum order of ${formatPaiseToInr(coupon.min_order_paise)} required for coupon ${coupon.code}.`,
              )
            }

            const incremented = await tx.$executeRaw`
              UPDATE coupons
              SET used_count = used_count + 1, updated_at = NOW()
              WHERE id = ${coupon.id}
                AND is_active = true
                AND (usage_limit IS NULL OR used_count < usage_limit)
            `
            if (incremented !== 1) {
              invalidCouponAttempt = true
              throw new BadRequestException(INVALID_COUPON_MESSAGE)
            }

            appliedCouponCode = coupon.code
            discountPaise = calc.discountPaise
          }

          const lineDiscounts = allocateProportionalDiscount(
            orderedLines.map((l) => l.lineSubtotalPaise),
            discountPaise,
          )
          const netItemsTotalPaise = itemsSubtotalPaise - discountPaise

          let finalShippingPaise = 0
          if (dto.fulfilmentMethod === FULFILMENT_METHOD.DELIVERY) {
            const freeShippingActive = isFreeShippingWindowActive({
              enabled: pricingSettings.freeShippingEnabledSetting,
              thresholdPaise: pricingSettings.freeShippingThresholdPaise,
              startsAt: pricingSettings.freeShippingStartsAt,
              endsAt: pricingSettings.freeShippingEndsAt,
            })
            const freeShippingQualified =
              freeShippingActive &&
              netItemsTotalPaise >= pricingSettings.freeShippingThresholdPaise &&
              netItemsTotalPaise > 0
            finalShippingPaise = freeShippingQualified ? 0 : shippingPaise
          }

          const codFeePaise =
            dto.paymentMethod === PAYMENT_METHOD.COD &&
            dto.fulfilmentMethod === FULFILMENT_METHOD.DELIVERY
              ? pricingSettings.codFeePaise
              : 0

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
          const totalPaise = netItemsTotalPaise + finalShippingPaise + codFeePaise + taxAddedPaise

          if (
            dto.paymentMethod === PAYMENT_METHOD.COD &&
            totalPaise > pricingSettings.codMaxOrderPaise
          ) {
            throw new BadRequestException(
              `Cash on Delivery orders cannot exceed ${formatPaiseToInr(pricingSettings.codMaxOrderPaise)}. Please pay online.`,
            )
          }

          let addressSnapshot: Prisma.InputJsonValue
          if (dto.fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP) {
            addressSnapshot = {
              mode: 'STORE_PICKUP',
              locationId: resolvedPickupLocation!.id,
              locationName: resolvedPickupLocation!.name,
              address: resolvedPickupLocation!.address,
              hours: resolvedPickupLocation!.hours,
            }
          } else {
            const addr = dto.address!
            await tx.address.create({
              data: {
                customer_id: customerId,
                name: addr.name.trim(),
                phone: addr.phone,
                line1: addr.line1.trim(),
                line2: addr.line2?.trim() ?? null,
                city: addr.city.trim(),
                state: addr.state.trim(),
                pincode: addr.pincode,
              },
            })
            addressSnapshot = {
              mode: 'DELIVERY',
              name: addr.name.trim(),
              phone: addr.phone,
              line1: addr.line1.trim(),
              line2: addr.line2?.trim() ?? null,
              city: addr.city.trim(),
              state: addr.state.trim(),
              pincode: addr.pincode,
            }
          }

          const orderId = randomUUID()
          const orderNumber = this.checkoutSecurity.generateOrderNumber()
          const isOnline = dto.paymentMethod === PAYMENT_METHOD.ONLINE

          let plaintextPickupCode: string | null = null
          let pickupCodeHash: string | null = null
          let pickupReadyAt: Date | null = null

          if (dto.fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP && !isOnline) {
            const codePair = this.checkoutSecurity.createPickupCodePair(orderId)
            plaintextPickupCode = codePair.plaintextCode
            pickupCodeHash = codePair.hmacHash
            pickupReadyAt = new Date(
              Date.now() + Math.max(1, resolvedPickupLocation!.prepTimeMinutes) * 60_000,
            )
          }

          const initialOrderStatus = isOnline
            ? PrismaOrderStatus.PENDING_PAYMENT
            : PrismaOrderStatus.COD_PENDING

          const createdOrder = await tx.order.create({
            data: {
              id: orderId,
              order_number: orderNumber,
              customer_id: customerId,
              address_snapshot: addressSnapshot,
              subtotal_paise: itemsSubtotalPaise,
              shipping_paise: finalShippingPaise,
              cod_fee_paise: codFeePaise,
              discount_paise: discountPaise,
              tax_paise: pricingSettings.showTaxBreakdown ? gst.taxPaise : 0,
              total_paise: totalPaise,
              coupon_code: appliedCouponCode,
              fulfilment_method:
                dto.fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP
                  ? PrismaFulfilmentMethod.STORE_PICKUP
                  : PrismaFulfilmentMethod.DELIVERY,
              pickup_location_id: resolvedPickupLocation?.id ?? null,
              pickup_code_hash: pickupCodeHash,
              pickup_ready_at: pickupReadyAt,
              dpdp_consent_at: new Date(),
              dpdp_policy_version: pricingSettings.dpdpPolicyVersion,
              marketing_consent: dto.marketingConsent,
              payment_method: isOnline ? PrismaPaymentMethod.ONLINE : PrismaPaymentMethod.COD,
              payment_status: PrismaPaymentStatus.PENDING,
              order_status: initialOrderStatus,
              items: {
                create: orderedLines.map((line, idx) => ({
                  variant_id: line.variant.id,
                  batch_id: null,
                  product_name_snapshot: line.variant.product_name,
                  size_snapshot: line.variant.size_label,
                  qty: line.qty,
                  unit_price_paise: line.variant.price_paise,
                  discount_paise: lineDiscounts[idx] ?? 0,
                })),
              },
              events: {
                create: {
                  status: initialOrderStatus,
                  note: isOnline
                    ? 'Order created; stock reserved for 15 minutes pending online payment'
                    : dto.fulfilmentMethod === FULFILMENT_METHOD.STORE_PICKUP
                      ? 'Store pickup order confirmed (Pay at store)'
                      : 'Cash on Delivery order placed',
                  actor: 'customer',
                },
              },
            },
          })

          // Update inventory atomically inside locked transaction
          for (const line of orderedLines) {
            if (isOnline) {
              await tx.variant.update({
                where: { id: line.variant.id },
                data: { reserved: { increment: line.qty } },
              })
              await tx.reservation.create({
                data: {
                  order_id: createdOrder.id,
                  variant_id: line.variant.id,
                  qty: line.qty,
                  expires_at: expiresAt,
                  status: PrismaReservationStatus.PENDING,
                },
              })
              await tx.stockMovement.create({
                data: {
                  variant_id: line.variant.id,
                  delta: -line.qty,
                  reason: STOCK_MOVEMENT_REASON.RESERVE,
                  order_id: createdOrder.id,
                  actor: 'checkout:online',
                },
              })
            } else {
              await tx.variant.update({
                where: { id: line.variant.id },
                data: { stock: { decrement: line.qty } },
              })
              await tx.stockMovement.create({
                data: {
                  variant_id: line.variant.id,
                  delta: -line.qty,
                  reason: STOCK_MOVEMENT_REASON.SALE,
                  order_id: createdOrder.id,
                  actor: 'checkout:cod',
                },
              })
            }
          }

          const orderSummary: CheckoutOrderSummaryDto = {
            id: createdOrder.id,
            orderNumber: createdOrder.order_number,
            fulfilmentMethod: dto.fulfilmentMethod,
            paymentMethod: dto.paymentMethod,
            paymentStatus: 'PENDING',
            orderStatus: isOnline ? 'PENDING_PAYMENT' : 'COD_PENDING',
            itemsSubtotalPaise,
            discountPaise,
            netItemsTotalPaise,
            shippingPaise: finalShippingPaise,
            codFeePaise,
            taxAddedPaise,
            totalPaise,
            tax: taxPayload,
            couponCode: appliedCouponCode,
            pickup: resolvedPickupLocation
              ? {
                  location: resolvedPickupLocation,
                  estimatedReadyDisplay: formatPickupReadyEstimateIndia(
                    resolvedPickupLocation.prepTimeMinutes,
                  ),
                }
              : null,
            pickupCode: plaintextPickupCode,
            reservationExpiresAt: isOnline ? expiresAt.toISOString() : null,
            needsAttention: false,
            dpdpPolicyVersion: pricingSettings.dpdpPolicyVersion,
            marketingConsent: dto.marketingConsent,
            createdAt: createdOrder.created_at.toISOString(),
            items: orderedLines.map((line, idx) => ({
              variantId: line.variant.id,
              productName: line.variant.product_name,
              sizeLabel: line.variant.size_label,
              qty: line.qty,
              unitPricePaise: line.variant.price_paise,
              discountPaise: lineDiscounts[idx] ?? 0,
              lineTotalPaise: line.lineSubtotalPaise - (lineDiscounts[idx] ?? 0),
            })),
          }

          if (!isOnline) {
            // Never persist plaintext pickup code into persistent DB idempotency response JSON
            const storedResponse: CheckoutResponseDto = {
              order: { ...orderSummary, pickupCode: null },
              payment: null,
            }
            await tx.checkoutIdempotencyKey.create({
              data: {
                key: idempotencyKey,
                request_hash: requestHash,
                order_id: createdOrder.id,
                status_code: 201,
                response_json: storedResponse as unknown as Prisma.InputJsonValue,
                expires_at: idempotencyExpiresAt,
              },
            })
          } else {
            // Lock in-progress sentinel row so duplicate clicks wait instead of reserving twice
            await tx.checkoutIdempotencyKey.create({
              data: {
                key: idempotencyKey,
                request_hash: requestHash,
                order_id: createdOrder.id,
                status_code: 102,
                response_json: {},
                expires_at: idempotencyExpiresAt,
              },
            })
          }

          return {
            kind: 'CREATED' as const,
            orderId: createdOrder.id,
            orderSummary,
            variantIds: sortedVariantIds,
          }
        })
        break
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : ''
          if (target.includes('order_number') && attempt < 2) {
            continue
          }
        }
        if (invalidCouponAttempt) {
          await this.cartRateLimitService.recordInvalidCouponAttempt(context.ip, context.sessionId)
        }
        throw err
      }
    }

    if (!txOutcome) {
      throw new ConflictException('Unable to complete checkout right now; please retry')
    }
    if (txOutcome.kind === 'REPLAY') {
      return txOutcome.response
    }

    await this.productCacheService.invalidateProductCache(undefined, txOutcome.variantIds)

    if (txOutcome.orderSummary.paymentMethod === PAYMENT_METHOD.COD) {
      return checkoutResponseSchema.parse({
        order: txOutcome.orderSummary,
        payment: null,
      })
    }

    // Create gateway order OUTSIDE the DB lock so network latency never blocks PostgreSQL connections
    try {
      const gatewayOrder = await this.paymentGateway.createOrder({
        orderId: txOutcome.orderId,
        orderNumber: txOutcome.orderSummary.orderNumber,
        amountPaise: txOutcome.orderSummary.totalPaise,
      })

      const paymentSession = {
        gateway: gatewayOrder.gateway,
        keyId: gatewayOrder.keyId,
        gatewayOrderId: gatewayOrder.gatewayOrderId,
        amountPaise: txOutcome.orderSummary.totalPaise,
        currency: 'INR' as const,
        brandName: pricingSettings.brandName,
        prefill: {
          name: dto.contact.name.trim(),
          contact: dto.contact.phone,
          ...(dto.contact.email ? { email: dto.contact.email.trim().toLowerCase() } : {}),
        },
        reservationExpiresAt: txOutcome.orderSummary.reservationExpiresAt!,
      }

      const finalResponse = checkoutResponseSchema.parse({
        order: txOutcome.orderSummary,
        payment: paymentSession,
      })

      const storedSafeResponse: CheckoutResponseDto = {
        order: { ...finalResponse.order, pickupCode: null },
        payment: finalResponse.payment,
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            order_id: txOutcome.orderId,
            gateway: gatewayOrder.gateway,
            gateway_order_id: gatewayOrder.gatewayOrderId,
            amount_paise: txOutcome.orderSummary.totalPaise,
            status: PrismaPaymentStatus.PENDING,
          },
        })
        await tx.checkoutIdempotencyKey.update({
          where: { key: idempotencyKey },
          data: {
            status_code: 201,
            response_json: storedSafeResponse as unknown as Prisma.InputJsonValue,
          },
        })
      })

      return finalResponse
    } catch (gatewayErr) {
      // Gateway initialization failed: release reserved stock cleanly & remove failed idempotency sentinel
      await this.releaseOrderReservationOnCancel(
        txOutcome.orderId,
        'GATEWAY_INIT_FAILED',
        'Payment gateway order initialization failed; stock released',
      )
      await this.prisma.checkoutIdempotencyKey
        .delete({ where: { key: idempotencyKey } })
        .catch(() => undefined)
      throw gatewayErr
    }
  }

  /**
   * Synchronous Razorpay signature verification endpoint.
   * Cryptographically verifies HMAC-SHA256 before invoking the shared idempotent markOrderPaid flow.
   */
  async verifyPayment(dto: CheckoutVerifyRequest): Promise<CheckoutVerifyResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { payments: { orderBy: { created_at: 'desc' } } },
    })
    if (!order) {
      throw new NotFoundException('Order not found')
    }
    const matchingPayment = order.payments.find((p) => p.gateway_order_id === dto.razorpayOrderId)
    if (!matchingPayment) {
      throw new BadRequestException('Payment reference does not match this order')
    }

    const validSignature = this.paymentGateway.verifyPaymentSignature({
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      razorpaySignature: dto.razorpaySignature,
    })

    if (!validSignature) {
      throw new BadRequestException('Invalid payment signature')
    }

    const outcome = await this.markOrderPaid({
      orderId: order.id,
      gatewayOrderId: dto.razorpayOrderId,
      gatewayPaymentId: dto.razorpayPaymentId,
      rawPayload: {
        razorpay_order_id: dto.razorpayOrderId,
        razorpay_payment_id: dto.razorpayPaymentId,
        verified_via: 'client_callback',
      },
      source: 'verify',
    })

    return checkoutVerifyResponseSchema.parse({
      order: outcome.order,
      alreadyProcessed: outcome.alreadyProcessed,
      autoRefunded: outcome.autoRefunded,
      message: outcome.message,
    })
  }

  /**
   * Non-production test helper used by dev/staging UI simulator to generate a real HMAC signature
   * without leaking any secret to the browser. Unconditionally blocked in production.
   */
  async mockCompleteOnlinePayment(orderId: string): Promise<CheckoutVerifyResponseDto> {
    if (this.isProdRuntime() || this.paymentGateway.getMode() !== 'mock') {
      throw new ForbiddenException('Mock payment completion is disabled in production')
    }
    const payment = await this.prisma.payment.findFirst({
      where: { order_id: orderId, status: PrismaPaymentStatus.PENDING },
      orderBy: { created_at: 'desc' },
    })
    if (!payment || !payment.gateway_order_id) {
      throw new NotFoundException('Pending online payment not found for this order')
    }
    const signed = this.paymentGateway.createMockSignedPayment(payment.gateway_order_id)
    return this.verifyPayment({
      orderId,
      ...signed,
    })
  }

  /**
   * Single idempotent order-payment confirmation handler shared by POST /checkout/verify,
   * reservation expiry reconciliation, and Phase 6 webhooks.
   */
  async markOrderPaid(input: MarkOrderPaidInput): Promise<MarkOrderPaidOutcome> {
    const pricingSettings = await this.settingsService.getInternalPricingSettings()

    const txResult = await this.prisma.$transaction(async (tx) => {
      // Check global gateway_payment_id uniqueness first (idempotent replay guard)
      const existingByPaymentId = await tx.payment.findUnique({
        where: { gateway_payment_id: input.gatewayPaymentId },
      })

      let targetOrderId = input.orderId ?? existingByPaymentId?.order_id
      if (!targetOrderId) {
        const paymentByOrderId = await tx.payment.findFirst({
          where: { gateway_order_id: input.gatewayOrderId },
          select: { order_id: true },
        })
        targetOrderId = paymentByOrderId?.order_id
      }
      if (!targetOrderId) {
        throw new NotFoundException('Order not found for payment confirmation')
      }

      // Lock Order row FOR UPDATE
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          subtotal_paise: number
          shipping_paise: number
          cod_fee_paise: number
          discount_paise: number
          tax_paise: number
          total_paise: number
          coupon_code: string | null
          fulfilment_method: PrismaFulfilmentMethod
          pickup_location_id: string | null
          pickup_code_hash: string | null
          pickup_ready_at: Date | null
          needs_attention: boolean
          dpdp_policy_version: string | null
          marketing_consent: boolean
          payment_method: PrismaPaymentMethod
          payment_status: PrismaPaymentStatus
          order_status: PrismaOrderStatus
          created_at: Date
        }>
      >`SELECT * FROM orders WHERE id = ${targetOrderId} FOR UPDATE`

      const lockedOrder = lockedOrders[0]
      if (!lockedOrder) {
        throw new NotFoundException('Order not found')
      }

      // Already captured / paid -> strict idempotent no-op
      if (
        existingByPaymentId?.status === PrismaPaymentStatus.CAPTURED ||
        ALREADY_PAID_STATUSES.has(lockedOrder.order_status) ||
        lockedOrder.payment_status === PrismaPaymentStatus.REFUNDED
      ) {
        const summary = await this.loadOrderSummary(tx, lockedOrder.id, null, pricingSettings)
        return {
          kind: 'ALREADY_PROCESSED' as const,
          summary,
          variantIds: [] as string[],
        }
      }

      const orderItems = await tx.orderItem.findMany({
        where: { order_id: lockedOrder.id },
        orderBy: { variant_id: 'asc' },
      })
      const variantIds = Array.from(new Set(orderItems.map((i) => i.variant_id))).sort()

      const lockedVariants = await tx.$queryRaw<LockedVariantRow[]>`
        SELECT
          v.id,
          v.product_id,
          v.sku,
          v.size_label,
          v.price_paise,
          v.mrp_paise,
          v.stock,
          v.reserved,
          v.low_stock_threshold,
          v.is_active AS v_active,
          p.slug AS product_slug,
          p.name AS product_name,
          p.is_active AS p_active
        FROM variants v
        INNER JOIN products p ON p.id = v.product_id
        WHERE v.id = ANY(${variantIds}::text[])
        ORDER BY v.id ASC
        FOR UPDATE OF v
      `
      const variantsById = new Map(lockedVariants.map((v) => [v.id, v]))

      const pendingReservations = await tx.reservation.findMany({
        where: { order_id: lockedOrder.id },
        orderBy: { variant_id: 'asc' },
      })

      const hasPendingReservation =
        lockedOrder.order_status === PrismaOrderStatus.PENDING_PAYMENT &&
        pendingReservations.some((r) => r.status === PrismaReservationStatus.PENDING)

      if (hasPendingReservation) {
        // Normal on-time payment confirmation: convert PENDING reservation to SOLD
        for (const item of orderItems) {
          await tx.variant.update({
            where: { id: item.variant_id },
            data: {
              stock: { decrement: item.qty },
              reserved: { decrement: item.qty },
            },
          })
          await tx.stockMovement.create({
            data: {
              variant_id: item.variant_id,
              delta: -item.qty,
              reason: STOCK_MOVEMENT_REASON.SALE,
              order_id: lockedOrder.id,
              actor: `payment:${input.source}`,
            },
          })
        }

        await tx.reservation.updateMany({
          where: { order_id: lockedOrder.id, status: PrismaReservationStatus.PENDING },
          data: { status: PrismaReservationStatus.CONFIRMED },
        })

        let plaintextPickupCode: string | null = null
        let pickupCodeHash = lockedOrder.pickup_code_hash
        let pickupReadyAt = lockedOrder.pickup_ready_at

        if (
          lockedOrder.fulfilment_method === PrismaFulfilmentMethod.STORE_PICKUP &&
          !pickupCodeHash
        ) {
          const pair = this.checkoutSecurity.createPickupCodePair(lockedOrder.id)
          plaintextPickupCode = pair.plaintextCode
          pickupCodeHash = pair.hmacHash
          const pickupLoc = pricingSettings.pickupLocations.find(
            (l) => l.id === lockedOrder.pickup_location_id,
          )
          pickupReadyAt = new Date(
            Date.now() + Math.max(1, pickupLoc?.prepTimeMinutes ?? 120) * 60_000,
          )
        }

        await this.upsertCapturedPayment(tx, {
          orderId: lockedOrder.id,
          gateway: this.paymentGateway.getMode(),
          gatewayOrderId: input.gatewayOrderId,
          gatewayPaymentId: input.gatewayPaymentId,
          amountPaise: lockedOrder.total_paise, // Strictly from server Order record
          rawPayload: input.rawPayload,
        })

        await tx.order.update({
          where: { id: lockedOrder.id },
          data: {
            order_status: PrismaOrderStatus.PAID,
            payment_status: PrismaPaymentStatus.CAPTURED,
            pickup_code_hash: pickupCodeHash,
            pickup_ready_at: pickupReadyAt,
          },
        })

        await tx.orderEvent.create({
          data: {
            order_id: lockedOrder.id,
            status: PrismaOrderStatus.PAID,
            note: `Payment captured (${input.gatewayPaymentId}) via ${input.source}`,
            actor: `payment:${input.source}`,
          },
        })

        const summary = await this.loadOrderSummary(
          tx,
          lockedOrder.id,
          plaintextPickupCode,
          pricingSettings,
        )
        return {
          kind: 'PAID' as const,
          summary,
          variantIds,
          lateAutoRefundNeeded: false,
        }
      }

      // Late payment path: reservation expired/released earlier! Try atomic stock re-allocation
      let canReallocate = true
      for (const item of orderItems) {
        const variant = variantsById.get(item.variant_id)
        if (!variant || !variant.v_active || !variant.p_active) {
          canReallocate = false
          break
        }
        const available = variant.stock - variant.reserved
        if (available < item.qty) {
          canReallocate = false
          break
        }
      }

      if (canReallocate && lockedOrder.coupon_code) {
        const couponRows = await tx.$queryRaw<
          Array<{
            id: string
            is_active: boolean
            expires_at: Date | null
            usage_limit: number | null
            used_count: number
          }>
        >`SELECT id, is_active, expires_at, usage_limit, used_count FROM coupons WHERE code = ${lockedOrder.coupon_code} FOR UPDATE`
        const coupon = couponRows[0]
        if (
          !coupon ||
          !coupon.is_active ||
          isCouponExpiredIndia(coupon.expires_at) ||
          (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit)
        ) {
          canReallocate = false
        } else {
          await tx.$executeRaw`
            UPDATE coupons SET used_count = used_count + 1, updated_at = NOW() WHERE id = ${coupon.id}
          `
        }
      }

      if (canReallocate) {
        for (const item of orderItems) {
          await tx.variant.update({
            where: { id: item.variant_id },
            data: { stock: { decrement: item.qty } },
          })
          await tx.stockMovement.create({
            data: {
              variant_id: item.variant_id,
              delta: -item.qty,
              reason: STOCK_MOVEMENT_REASON.SALE,
              order_id: lockedOrder.id,
              actor: `late-payment:${input.source}`,
            },
          })
        }

        await tx.reservation.updateMany({
          where: { order_id: lockedOrder.id },
          data: { status: PrismaReservationStatus.CONFIRMED },
        })

        let plaintextPickupCode: string | null = null
        let pickupCodeHash = lockedOrder.pickup_code_hash
        let pickupReadyAt = lockedOrder.pickup_ready_at
        if (
          lockedOrder.fulfilment_method === PrismaFulfilmentMethod.STORE_PICKUP &&
          !pickupCodeHash
        ) {
          const pair = this.checkoutSecurity.createPickupCodePair(lockedOrder.id)
          plaintextPickupCode = pair.plaintextCode
          pickupCodeHash = pair.hmacHash
          const pickupLoc = pricingSettings.pickupLocations.find(
            (l) => l.id === lockedOrder.pickup_location_id,
          )
          pickupReadyAt = new Date(
            Date.now() + Math.max(1, pickupLoc?.prepTimeMinutes ?? 120) * 60_000,
          )
        }

        await this.upsertCapturedPayment(tx, {
          orderId: lockedOrder.id,
          gateway: this.paymentGateway.getMode(),
          gatewayOrderId: input.gatewayOrderId,
          gatewayPaymentId: input.gatewayPaymentId,
          amountPaise: lockedOrder.total_paise,
          rawPayload: input.rawPayload,
        })

        await tx.order.update({
          where: { id: lockedOrder.id },
          data: {
            order_status: PrismaOrderStatus.PAID,
            payment_status: PrismaPaymentStatus.CAPTURED,
            needs_attention: true,
            pickup_code_hash: pickupCodeHash,
            pickup_ready_at: pickupReadyAt,
          },
        })

        await tx.orderEvent.create({
          data: {
            order_id: lockedOrder.id,
            status: PrismaOrderStatus.PAID,
            note: `Late payment captured (${input.gatewayPaymentId}) after expiry; stock re-allocated`,
            actor: `late-payment:${input.source}`,
          },
        })

        const summary = await this.loadOrderSummary(
          tx,
          lockedOrder.id,
          plaintextPickupCode,
          pricingSettings,
        )
        return {
          kind: 'PAID' as const,
          summary,
          variantIds,
          lateAutoRefundNeeded: false,
        }
      }

      // Stock is gone after late payment: record capture & mark needs_attention for immediate auto-refund
      await this.upsertCapturedPayment(tx, {
        orderId: lockedOrder.id,
        gateway: this.paymentGateway.getMode(),
        gatewayOrderId: input.gatewayOrderId,
        gatewayPaymentId: input.gatewayPaymentId,
        amountPaise: lockedOrder.total_paise,
        rawPayload: input.rawPayload,
      })

      await tx.order.update({
        where: { id: lockedOrder.id },
        data: {
          order_status: PrismaOrderStatus.CANCELLED,
          payment_status: PrismaPaymentStatus.CAPTURED,
          needs_attention: true,
        },
      })

      await tx.orderEvent.create({
        data: {
          order_id: lockedOrder.id,
          status: PrismaOrderStatus.CANCELLED,
          note: `Late payment ${input.gatewayPaymentId} received after reservation expired and stock exhausted; initiating automatic refund`,
          actor: `late-payment:${input.source}`,
        },
      })

      const summary = await this.loadOrderSummary(tx, lockedOrder.id, null, pricingSettings)
      return {
        kind: 'LATE_OOS_REFUND' as const,
        summary,
        variantIds: [] as string[],
        refundAmountPaise: lockedOrder.total_paise,
        lateAutoRefundNeeded: true,
      }
    })

    if (txResult.kind === 'ALREADY_PROCESSED') {
      return {
        order: txResult.summary,
        alreadyProcessed: true,
        autoRefunded: false,
        refundSucceeded: false,
        message: 'Payment was already processed.',
      }
    }

    if (txResult.kind === 'PAID') {
      await this.productCacheService.invalidateProductCache(undefined, txResult.variantIds)
      return {
        order: txResult.summary,
        alreadyProcessed: false,
        autoRefunded: false,
        refundSucceeded: false,
        message: 'Payment confirmed.',
      }
    }

    // Outside DB lock: execute automatic refund via gateway
    const refund = await this.paymentGateway.refundCapturedPayment({
      gatewayPaymentId: input.gatewayPaymentId,
      amountPaise: txResult.refundAmountPaise,
      reason: 'Stock sold out after 15-minute checkout reservation expired',
    })

    const updatedSummary = await this.prisma.$transaction(async (tx) => {
      if (refund.refunded) {
        await tx.payment.updateMany({
          where: { gateway_payment_id: input.gatewayPaymentId },
          data: { status: PrismaPaymentStatus.REFUNDED },
        })
        await tx.order.update({
          where: { id: txResult.summary.id },
          data: {
            order_status: PrismaOrderStatus.CANCELLED,
            payment_status: PrismaPaymentStatus.REFUNDED,
            needs_attention: true,
          },
        })
        await tx.orderEvent.create({
          data: {
            order_id: txResult.summary.id,
            status: PrismaOrderStatus.CANCELLED,
            note: `Automatic refund issued (${refund.refundId ?? 'processed'}) because stock ran out before late payment completed`,
            actor: 'system:auto-refund',
          },
        })
      } else {
        await tx.orderEvent.create({
          data: {
            order_id: txResult.summary.id,
            status: PrismaOrderStatus.CANCELLED,
            note: `Automatic refund requires manual retry: ${refund.error ?? 'unknown error'}`,
            actor: 'system:auto-refund',
          },
        })
      }
      return this.loadOrderSummary(tx, txResult.summary.id, null, pricingSettings)
    })

    return {
      order: updatedSummary,
      alreadyProcessed: false,
      autoRefunded: true,
      refundSucceeded: refund.refunded,
      message: refund.refunded
        ? 'Your payment arrived after the reservation expired and items sold out. A full refund has been initiated automatically.'
        : 'Your payment arrived after the items sold out. Our team has flagged your order for an immediate refund.',
    }
  }

  private async upsertCapturedPayment(
    tx: Prisma.TransactionClient,
    data: {
      orderId: string
      gateway: string
      gatewayOrderId: string
      gatewayPaymentId: string
      amountPaise: number
      rawPayload?: unknown
    },
  ): Promise<void> {
    const existingPending = await tx.payment.findFirst({
      where: {
        order_id: data.orderId,
        gateway_order_id: data.gatewayOrderId,
      },
    })

    if (existingPending) {
      await tx.payment.update({
        where: { id: existingPending.id },
        data: {
          gateway_payment_id: data.gatewayPaymentId,
          status: PrismaPaymentStatus.CAPTURED,
          raw_payload: (data.rawPayload ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      })
    } else {
      await tx.payment.create({
        data: {
          order_id: data.orderId,
          gateway: data.gateway,
          gateway_order_id: data.gatewayOrderId,
          gateway_payment_id: data.gatewayPaymentId,
          amount_paise: data.amountPaise,
          status: PrismaPaymentStatus.CAPTURED,
          raw_payload: (data.rawPayload ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      })
    }
  }

  async failOrCancelCheckout(dto: CheckoutFailRequest): Promise<CheckoutFailResponseDto> {
    const note = dto.errorDescription
      ? `${dto.reason}: ${dto.errorDescription}`
      : `Customer checkout ended with ${dto.reason}`
    const outcome = await this.releaseOrderReservationOnCancel(dto.orderId, dto.reason, note)
    return checkoutFailResponseSchema.parse(outcome)
  }

  async releaseOrderReservationOnCancel(
    orderId: string,
    reasonCode: string,
    note: string,
    reservationTargetStatus: PrismaReservationStatus = PrismaReservationStatus.RELEASED,
  ): Promise<CheckoutFailResponseDto> {
    const res = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          order_status: PrismaOrderStatus
          coupon_code: string | null
        }>
      >`SELECT id, order_number, order_status, coupon_code FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) {
        throw new NotFoundException('Order not found')
      }

      if (order.order_status !== PrismaOrderStatus.PENDING_PAYMENT) {
        const safeStatus =
          order.order_status === PrismaOrderStatus.COD_PENDING
            ? 'COD_PENDING'
            : order.order_status === PrismaOrderStatus.CANCELLED
              ? 'CANCELLED'
              : 'PAID'
        return {
          orderId: order.id,
          orderNumber: order.order_number,
          orderStatus: safeStatus as 'CANCELLED' | 'PAID' | 'COD_PENDING',
          released: false,
          variantIds: [] as string[],
          message:
            safeStatus === 'PAID'
              ? 'Payment was already completed for this order.'
              : 'Order reservation was already released.',
        }
      }

      const pendingReservations = await tx.reservation.findMany({
        where: { order_id: order.id, status: PrismaReservationStatus.PENDING },
        orderBy: { variant_id: 'asc' },
      })

      const variantIds = Array.from(new Set(pendingReservations.map((r) => r.variant_id))).sort()
      if (variantIds.length > 0) {
        await tx.$queryRaw`
          SELECT id FROM variants WHERE id = ANY(${variantIds}::text[]) ORDER BY id ASC FOR UPDATE
        `
      }

      for (const reservation of pendingReservations) {
        await tx.variant.update({
          where: { id: reservation.variant_id },
          data: { reserved: { decrement: reservation.qty } },
        })
        await tx.stockMovement.create({
          data: {
            variant_id: reservation.variant_id,
            delta: reservation.qty,
            reason: STOCK_MOVEMENT_REASON.RELEASE,
            order_id: order.id,
            actor: `checkout:${reasonCode.toLowerCase()}`,
          },
        })
      }

      await tx.reservation.updateMany({
        where: { order_id: order.id, status: PrismaReservationStatus.PENDING },
        data: { status: reservationTargetStatus },
      })

      if (order.coupon_code && pendingReservations.length > 0) {
        await tx.$executeRaw`
          UPDATE coupons
          SET used_count = GREATEST(0, used_count - 1), updated_at = NOW()
          WHERE code = ${order.coupon_code}
        `
      }

      await tx.payment.updateMany({
        where: { order_id: order.id, status: PrismaPaymentStatus.PENDING },
        data: { status: PrismaPaymentStatus.FAILED },
      })

      await tx.order.update({
        where: { id: order.id },
        data: {
          order_status: PrismaOrderStatus.CANCELLED,
          payment_status: PrismaPaymentStatus.FAILED,
        },
      })

      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: PrismaOrderStatus.CANCELLED,
          note,
          actor: `system:${reasonCode.toLowerCase()}`,
        },
      })

      return {
        orderId: order.id,
        orderNumber: order.order_number,
        orderStatus: 'CANCELLED' as const,
        released: pendingReservations.length > 0,
        variantIds,
        message: 'Reserved stock released cleanly.',
      }
    })

    if (res.variantIds.length > 0) {
      await this.productCacheService.invalidateProductCache(undefined, res.variantIds)
    }

    return {
      orderId: res.orderId,
      orderNumber: res.orderNumber,
      orderStatus: res.orderStatus,
      released: res.released,
      message: res.message,
    }
  }

  /**
   * Cancels a confirmed COD or PAID order and restores stock with an explicit CANCEL movement.
   */
  async cancelConfirmedOrder(
    orderId: string,
    reason: string,
    actor: string = 'system:cancel',
  ): Promise<{ cancelled: boolean; restoredUnits: number }> {
    const res = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_status: PrismaOrderStatus
          fulfilment_method: PrismaFulfilmentMethod
          coupon_code: string | null
        }>
      >`SELECT id, order_status, fulfilment_method, coupon_code FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) {
        throw new NotFoundException('Order not found')
      }

      if (order.order_status === PrismaOrderStatus.CANCELLED) {
        return { cancelled: false, restoredUnits: 0, variantIds: [] as string[] }
      }

      const canCancel = canTransitionOrderStatus(
        order.order_status as OrderStatus,
        ORDER_STATUS.CANCELLED,
        order.fulfilment_method,
      )
      if (!canCancel) {
        throw new BadRequestException(`Cannot cancel order in status ${order.order_status}`)
      }

      const items = await tx.orderItem.findMany({
        where: { order_id: order.id },
        orderBy: { variant_id: 'asc' },
      })
      const variantIds = Array.from(new Set(items.map((i) => i.variant_id))).sort()
      if (variantIds.length > 0) {
        await tx.$queryRaw`
          SELECT id FROM variants WHERE id = ANY(${variantIds}::text[]) ORDER BY id ASC FOR UPDATE
        `
      }

      let restoredUnits = 0
      if (order.order_status === PrismaOrderStatus.PENDING_PAYMENT) {
        const pendingRes = await tx.reservation.findMany({
          where: { order_id: order.id, status: PrismaReservationStatus.PENDING },
        })
        for (const r of pendingRes) {
          await tx.variant.update({
            where: { id: r.variant_id },
            data: { reserved: { decrement: r.qty } },
          })
          await tx.stockMovement.create({
            data: {
              variant_id: r.variant_id,
              delta: r.qty,
              reason: STOCK_MOVEMENT_REASON.RELEASE,
              order_id: order.id,
              actor,
            },
          })
          restoredUnits += r.qty
        }
        await tx.reservation.updateMany({
          where: { order_id: order.id, status: PrismaReservationStatus.PENDING },
          data: { status: PrismaReservationStatus.RELEASED },
        })
      } else {
        for (const item of items) {
          await tx.variant.update({
            where: { id: item.variant_id },
            data: { stock: { increment: item.qty } },
          })
          await tx.stockMovement.create({
            data: {
              variant_id: item.variant_id,
              delta: item.qty,
              reason: STOCK_MOVEMENT_REASON.CANCEL,
              order_id: order.id,
              actor,
            },
          })
          restoredUnits += item.qty
        }
      }

      if (order.coupon_code) {
        await tx.$executeRaw`
          UPDATE coupons
          SET used_count = GREATEST(0, used_count - 1), updated_at = NOW()
          WHERE code = ${order.coupon_code}
        `
      }

      await tx.order.update({
        where: { id: order.id },
        data: { order_status: PrismaOrderStatus.CANCELLED },
      })
      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: PrismaOrderStatus.CANCELLED,
          note: reason,
          actor,
        },
      })

      return { cancelled: true, restoredUnits, variantIds }
    })

    if (res.variantIds.length > 0) {
      await this.productCacheService.invalidateProductCache(undefined, res.variantIds)
    }

    return { cancelled: res.cancelled, restoredUnits: res.restoredUnits }
  }

  /**
   * Releases expired PENDING reservations past the 15-minute TTL + 2-minute grace window.
   * Always queries Razorpay payment status BEFORE releasing stock so completed payments are captured cleanly.
   */
  async releaseExpiredReservations(
    now: Date = new Date(),
  ): Promise<{ expiredCount: number; recoveredPaidCount: number }> {
    const cutoff = new Date(now.getTime() - RESERVATION_GRACE_MINUTES * 60_000)

    const staleRows = await this.prisma.reservation.findMany({
      where: {
        status: PrismaReservationStatus.PENDING,
        expires_at: { lte: cutoff },
      },
      distinct: ['order_id'],
      select: { order_id: true },
      take: 100,
    })

    let expiredCount = 0
    let recoveredPaidCount = 0

    for (const row of staleRows) {
      const payment = await this.prisma.payment.findFirst({
        where: { order_id: row.order_id, gateway_order_id: { not: null } },
        orderBy: { created_at: 'desc' },
      })

      if (payment?.gateway_order_id) {
        const status = await this.paymentGateway.fetchOrderPaymentStatus(payment.gateway_order_id)
        if (status.capturedPaymentId) {
          await this.markOrderPaid({
            orderId: row.order_id,
            gatewayOrderId: payment.gateway_order_id,
            gatewayPaymentId: status.capturedPaymentId,
            rawPayload: status.raw,
            source: 'reconcile',
          })
          recoveredPaidCount += 1
          continue
        }
      }

      const released = await this.releaseOrderReservationOnCancel(
        row.order_id,
        'RESERVATION_EXPIRED',
        'Checkout reservation expired after 15-minute window and grace period',
        PrismaReservationStatus.EXPIRED,
      )
      if (released.released) {
        expiredCount += 1
      }
    }

    return { expiredCount, recoveredPaidCount }
  }

  /**
   * Brute-force-protected pickup verification code checker (lock after 5 failed attempts).
   * Ready for store pickup handoff / Phase 8/9 workflows without leaking plaintext codes.
   */
  async verifyPickupCodeAttempt(
    orderId: string,
    candidateCode: string,
  ): Promise<{ valid: boolean; lockedUntil: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRaw<
        Array<{
          id: string
          pickup_code_hash: string | null
          pickup_code_attempts: number
          pickup_code_locked_until: Date | null
        }>
      >`SELECT id, pickup_code_hash, pickup_code_attempts, pickup_code_locked_until FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = orders[0]
      if (!order || !order.pickup_code_hash) {
        throw new NotFoundException('Pickup verification code is not active for this order')
      }

      const now = new Date()
      if (order.pickup_code_locked_until && order.pickup_code_locked_until > now) {
        return {
          valid: false,
          lockedUntil: order.pickup_code_locked_until.toISOString(),
        }
      }

      const matches = this.checkoutSecurity.verifyPickupCode(
        order.id,
        candidateCode,
        order.pickup_code_hash,
      )
      if (matches) {
        await tx.order.update({
          where: { id: order.id },
          data: { pickup_code_attempts: 0, pickup_code_locked_until: null },
        })
        return { valid: true, lockedUntil: null }
      }

      const nextAttempts = order.pickup_code_attempts + 1
      const lockUntil =
        nextAttempts >= PICKUP_CODE_MAX_ATTEMPTS ? new Date(now.getTime() + 30 * 60_000) : null

      await tx.order.update({
        where: { id: order.id },
        data: {
          pickup_code_attempts: nextAttempts,
          pickup_code_locked_until: lockUntil,
        },
      })

      return {
        valid: false,
        lockedUntil: lockUntil ? lockUntil.toISOString() : null,
      }
    })
  }

  private async loadOrderSummary(
    tx: Prisma.TransactionClient,
    orderId: string,
    plaintextPickupCode: string | null,
    pricingSettings: Awaited<ReturnType<SettingsService['getInternalPricingSettings']>>,
  ): Promise<CheckoutOrderSummaryDto> {
    const full = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: true,
        reservations: { take: 1, orderBy: { expires_at: 'desc' } },
      },
    })

    const netItemsTotalPaise = full.subtotal_paise - full.discount_paise
    const gst = computeGstBreakdownPaise(
      netItemsTotalPaise,
      pricingSettings.gstRateBps,
      pricingSettings.gstIncludedInPrice,
    )
    const taxAddedPaise = pricingSettings.showTaxBreakdown ? gst.addedTaxPaise : 0
    const taxPayload: CartTaxBreakdownDto = pricingSettings.showTaxBreakdown
      ? {
          showTaxBreakdown: true,
          rateBps: pricingSettings.gstRateBps,
          includedInPrice: pricingSettings.gstIncludedInPrice,
          taxPaise: full.tax_paise,
        }
      : { showTaxBreakdown: false }

    let pickupSummary: CheckoutOrderSummaryDto['pickup'] = null
    if (full.fulfilment_method === PrismaFulfilmentMethod.STORE_PICKUP && full.pickup_location_id) {
      const loc = pricingSettings.pickupLocations.find((p) => p.id === full.pickup_location_id)
      const snapshot = (full.address_snapshot as Record<string, unknown>) ?? {}
      const locationDto = loc ?? {
        id: full.pickup_location_id,
        name:
          typeof snapshot.locationName === 'string'
            ? snapshot.locationName
            : 'Store pickup location',
        address: typeof snapshot.address === 'string' ? snapshot.address : '',
        hours: typeof snapshot.hours === 'string' ? snapshot.hours : '',
        prepTimeMinutes: 120,
        isSample: false,
      }
      pickupSummary = {
        location: locationDto,
        estimatedReadyDisplay: formatPickupReadyEstimateIndia(
          locationDto.prepTimeMinutes,
          full.created_at,
        ),
      }
    }

    const activeReservation = full.reservations[0]

    return {
      id: full.id,
      orderNumber: full.order_number,
      fulfilmentMethod: full.fulfilment_method,
      paymentMethod: full.payment_method,
      paymentStatus: full.payment_status as PaymentStatus,
      orderStatus: full.order_status as OrderStatus,
      itemsSubtotalPaise: full.subtotal_paise,
      discountPaise: full.discount_paise,
      netItemsTotalPaise,
      shippingPaise: full.shipping_paise,
      codFeePaise: full.cod_fee_paise,
      taxAddedPaise,
      totalPaise: full.total_paise,
      tax: taxPayload,
      couponCode: full.coupon_code,
      pickup: pickupSummary,
      pickupCode: plaintextPickupCode,
      reservationExpiresAt:
        full.order_status === PrismaOrderStatus.PENDING_PAYMENT && activeReservation
          ? activeReservation.expires_at.toISOString()
          : null,
      needsAttention: full.needs_attention,
      dpdpPolicyVersion: full.dpdp_policy_version,
      marketingConsent: full.marketing_consent,
      createdAt: full.created_at.toISOString(),
      items: full.items.map((item) => {
        const lineSub = item.unit_price_paise * item.qty
        return {
          variantId: item.variant_id,
          productName: item.product_name_snapshot,
          sizeLabel: item.size_snapshot,
          qty: item.qty,
          unitPricePaise: item.unit_price_paise,
          discountPaise: item.discount_paise,
          lineTotalPaise: Math.max(0, lineSub - item.discount_paise),
        }
      }),
    }
  }
}
