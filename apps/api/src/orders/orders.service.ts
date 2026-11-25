import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  FulfilmentMethod as PrismaFulfilmentMethod,
  OrderStatus as PrismaOrderStatus,
  PaymentMethod as PrismaPaymentMethod,
  PaymentStatus as PrismaPaymentStatus,
  Prisma,
  ReservationStatus as PrismaReservationStatus,
} from '@prisma/client'
import {
  type AdminCancelOrderDto,
  type AdminCancelOrderResponseDto,
  adminCancelOrderResponseSchema,
  type AdminConfirmOrderDto,
  type AdminOrderTransitionResponseDto,
  adminOrderTransitionResponseSchema,
  type AdminPackOrderDto,
  type AdminPickupCompleteDto,
  type AdminRefundOrderDto,
  type AdminRefundOrderResponseDto,
  adminRefundOrderResponseSchema,
  type AdminReturnStockDto,
  type AdminReturnStockResponseDto,
  adminReturnStockResponseSchema,
  type AdminShipOrderDto,
  type AdminTestAlertDto,
  type AdminTestAlertResponseDto,
  adminTestAlertResponseSchema,
  ALERT_SEVERITY,
  canTransitionOrderStatus,
  formatDateIndia,
  ORDER_STATUS,
  type OrderStatus,
  OTP_CONSTANTS,
  OTP_PURPOSE,
  type PickupCodeReissueRequestDto,
  type PickupCodeReissueResponseDto,
  pickupCodeReissueResponseSchema,
  STOCK_MOVEMENT_REASON,
} from '@pressedoils/shared'
import { CheckoutSecurityService } from '../checkout/checkout-security.service'
import { CheckoutService } from '../checkout/checkout.service'
import { PaymentGatewayService } from '../checkout/payment-gateway.service'
import { env } from '../env'
import { maskEmail, maskPhone } from '../notifications/notification.types'
import { OtpService } from '../otp/otp.service'
import { PrismaService } from '../prisma/prisma.service'
import { ProductCacheService } from '../products/products.cache'
import { OpsAlertService } from '../queue/ops-alert.service'
import { QueueService } from '../queue/queue.service'
import { SettingsService } from '../settings/settings.service'

const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{16,128}$/

const RETURN_ELIGIBLE_ORDER_STATUSES = new Set<PrismaOrderStatus>([
  PrismaOrderStatus.SHIPPED,
  PrismaOrderStatus.DELIVERED,
  PrismaOrderStatus.PICKED_UP,
  PrismaOrderStatus.REFUNDED,
])

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGatewayService,
    private readonly productCacheService: ProductCacheService,
    private readonly queueService: QueueService,
    private readonly opsAlertService: OpsAlertService,
    private readonly checkoutService: CheckoutService,
    private readonly checkoutSecurity: CheckoutSecurityService,
    private readonly otpService: OtpService,
    private readonly settingsService: SettingsService,
  ) {}

  private async resolveActiveAdmin(adminEmail: string | undefined) {
    const normalizedEmail = (adminEmail ?? '').trim().toLowerCase()
    if (!normalizedEmail) {
      throw new ForbiddenException('Admin email header (x-admin-email) is required')
    }
    const admin = await this.prisma.admin.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, role: true, is_active: true },
    })
    if (!admin || !admin.is_active) {
      throw new ForbiddenException('Active admin account required')
    }
    return admin
  }

  /**
   * Manually confirms a PAID (when auto_confirm_paid_orders=false) or COD_PENDING order.
   */
  async confirmOrder(
    orderId: string,
    adminEmail: string | undefined,
    dto: AdminConfirmOrderDto,
  ): Promise<{ orderId: string; orderNumber: string; orderStatus: 'CONFIRMED' }> {
    const admin = await this.resolveActiveAdmin(adminEmail)

    const result = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          order_status: PrismaOrderStatus
          fulfilment_method: string
        }>
      >`SELECT id, order_number, order_status, fulfilment_method FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) {
        throw new NotFoundException('Order not found')
      }

      if (order.order_status === PrismaOrderStatus.CONFIRMED) {
        throw new ConflictException('Order is already confirmed')
      }

      const canConfirm = canTransitionOrderStatus(
        order.order_status as OrderStatus,
        ORDER_STATUS.CONFIRMED,
        order.fulfilment_method as 'DELIVERY' | 'STORE_PICKUP',
      )
      if (!canConfirm) {
        throw new BadRequestException(`Cannot confirm order in status ${order.order_status}`)
      }

      const note = dto.reason?.trim() || 'Order confirmed manually by admin'

      await tx.order.update({
        where: { id: order.id },
        data: { order_status: PrismaOrderStatus.CONFIRMED },
      })

      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: PrismaOrderStatus.CONFIRMED,
          note,
          actor: `admin:${admin.email}`,
        },
      })

      await tx.auditLog.create({
        data: {
          admin_id: admin.id,
          action: 'ORDER_CONFIRMED',
          entity: 'Order',
          entity_id: order.id,
          before: { orderStatus: order.order_status },
          after: { orderStatus: ORDER_STATUS.CONFIRMED, reason: note },
        },
      })

      return {
        orderId: order.id,
        orderNumber: order.order_number,
        orderStatus: 'CONFIRMED' as const,
      }
    })

    void this.queueService.enqueueCustomerNotification({
      event: 'ORDER_CONFIRMED',
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      message: `Order ${result.orderNumber} confirmed by admin`,
    })

    return result
  }

  /**
   * Cancels an unshipped order, restores stock ONCE cleanly inside a locked transaction,
   * writes AuditLog + OrderEvent + StockMovement, and initiates a gateway refund if captured.
   * Rejects duplicate cancellations (409) and post-shipment orders (400).
   */
  async cancelOrder(
    orderId: string,
    adminEmail: string | undefined,
    dto: AdminCancelOrderDto,
  ): Promise<AdminCancelOrderResponseDto> {
    const admin = await this.resolveActiveAdmin(adminEmail)

    const txOutcome = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          order_status: PrismaOrderStatus
          payment_method: PrismaPaymentMethod
          payment_status: PrismaPaymentStatus
          fulfilment_method: string
          total_paise: number
          refunded_paise: number
          coupon_code: string | null
        }>
      >`SELECT id, order_number, order_status, payment_method, payment_status, fulfilment_method, total_paise, refunded_paise, coupon_code FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) {
        throw new NotFoundException('Order not found')
      }

      if (
        order.order_status === PrismaOrderStatus.CANCELLED ||
        order.order_status === PrismaOrderStatus.REFUNDED
      ) {
        throw new ConflictException(
          `Order ${order.order_number} is already ${order.order_status}; cannot cancel or restore stock twice`,
        )
      }

      const canCancel = canTransitionOrderStatus(
        order.order_status as OrderStatus,
        ORDER_STATUS.CANCELLED,
        order.fulfilment_method as 'DELIVERY' | 'STORE_PICKUP',
      )
      if (!canCancel) {
        throw new BadRequestException(
          `Cannot cancel order in status ${order.order_status}; use return-stock for shipped/delivered orders`,
        )
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
              actor: `admin:${admin.email}`,
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
              actor: `admin:${admin.email}`,
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
          note: dto.reason,
          actor: `admin:${admin.email}`,
        },
      })

      // Check if captured online payment still has refundable balance
      let pendingRefundRow: {
        refundId: string
        paymentId: string
        gatewayPaymentId: string
        amountPaise: number
      } | null = null

      if (order.payment_method === PrismaPaymentMethod.ONLINE) {
        const capturedPayment = await tx.payment.findFirst({
          where: {
            order_id: order.id,
            gateway_payment_id: { not: null },
            status: {
              in: [PrismaPaymentStatus.CAPTURED, PrismaPaymentStatus.PARTIALLY_REFUNDED],
            },
          },
          orderBy: { created_at: 'desc' },
        })
        const activeRefunds = await tx.refund.findMany({
          where: {
            order_id: order.id,
            status: { in: ['PENDING', 'PROCESSED'] },
          },
          select: { amount_paise: true },
        })
        const committedPaise = Math.max(
          order.refunded_paise,
          activeRefunds.reduce((sum, r) => sum + r.amount_paise, 0),
        )
        const remainingPaise = Math.max(0, order.total_paise - committedPaise)

        if (capturedPayment?.gateway_payment_id && remainingPaise > 0) {
          const createdRefund = await tx.refund.create({
            data: {
              order_id: order.id,
              payment_id: capturedPayment.id,
              amount_paise: remainingPaise,
              status: 'PENDING',
              reason: dto.reason,
              initiated_by: `admin:${admin.email}`,
            },
          })
          pendingRefundRow = {
            refundId: createdRefund.id,
            paymentId: capturedPayment.id,
            gatewayPaymentId: capturedPayment.gateway_payment_id,
            amountPaise: remainingPaise,
          }
        }
      }

      await tx.auditLog.create({
        data: {
          admin_id: admin.id,
          action: 'ORDER_CANCELLED',
          entity: 'Order',
          entity_id: order.id,
          before: { orderStatus: order.order_status, paymentStatus: order.payment_status },
          after: {
            orderStatus: ORDER_STATUS.CANCELLED,
            restoredUnits,
            refundInitiated: Boolean(pendingRefundRow),
            reason: dto.reason,
          },
        },
      })

      return {
        orderId: order.id,
        orderNumber: order.order_number,
        restoredUnits,
        variantIds,
        pendingRefundRow,
      }
    })

    if (txOutcome.variantIds.length > 0) {
      await this.productCacheService.invalidateProductCache(undefined, txOutcome.variantIds)
    }

    let gatewayRefundId: string | null = null
    let refundInitiated = false

    if (txOutcome.pendingRefundRow) {
      const pending = txOutcome.pendingRefundRow
      const gwResult = await this.paymentGateway.refundCapturedPayment({
        gatewayPaymentId: pending.gatewayPaymentId,
        amountPaise: pending.amountPaise,
        reason: dto.reason,
      })

      if (gwResult.refunded) {
        gatewayRefundId = gwResult.refundId
        refundInitiated = true
        await this.prisma.refund.update({
          where: { id: pending.refundId },
          data: { gateway_refund_id: gwResult.refundId },
        })
      } else {
        await this.prisma.$transaction(async (tx) => {
          await tx.refund.update({
            where: { id: pending.refundId },
            data: { status: 'FAILED' },
          })
          await tx.order.update({
            where: { id: txOutcome.orderId },
            data: { needs_attention: true },
          })
          await tx.orderEvent.create({
            data: {
              order_id: txOutcome.orderId,
              status: PrismaOrderStatus.CANCELLED,
              note: `Cancel succeeded and stock restored, but gateway refund initiation failed: ${gwResult.error ?? 'unknown error'}`,
              actor: `admin:${admin.email}`,
            },
          })
        })
        await this.opsAlertService.alertCritical({
          alertKey: 'admin-cancel-refund-failed',
          severity: ALERT_SEVERITY.CRITICAL,
          orderId: txOutcome.orderId,
          orderNumber: txOutcome.orderNumber,
          message: `Admin cancelled order ${txOutcome.orderNumber}, but gateway refund failed: ${gwResult.error ?? 'unknown'}`,
          details: { refundId: pending.refundId, amountPaise: pending.amountPaise },
        })
      }
    }

    void this.queueService.enqueueCustomerNotification({
      event: 'ORDER_CANCELLED',
      orderId: txOutcome.orderId,
      orderNumber: txOutcome.orderNumber,
      message: `Order ${txOutcome.orderNumber} cancelled${refundInitiated ? ' and refund initiated' : ''}`,
    })

    return adminCancelOrderResponseSchema.parse({
      orderId: txOutcome.orderId,
      orderNumber: txOutcome.orderNumber,
      orderStatus: 'CANCELLED',
      restoredUnits: txOutcome.restoredUnits,
      refundInitiated,
      refundId: txOutcome.pendingRefundRow?.refundId ?? null,
      gatewayRefundId,
    })
  }

  /**
   * Initiates a full or partial Razorpay refund against a captured payment using an Idempotency-Key.
   * Financial status is finalized by the incoming `refund.processed` webhook.
   */
  async refundOrder(
    orderId: string,
    adminEmail: string | undefined,
    idempotencyKeyHeader: string | undefined,
    dto: AdminRefundOrderDto,
  ): Promise<AdminRefundOrderResponseDto> {
    const admin = await this.resolveActiveAdmin(adminEmail)
    const idempotencyKey = idempotencyKeyHeader?.trim()
    if (!idempotencyKey || !IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
      throw new BadRequestException(
        'A valid Idempotency-Key header (16-128 alphanumeric/hyphen characters) is required for refunds',
      )
    }

    const prep = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          order_status: PrismaOrderStatus
          payment_method: PrismaPaymentMethod
          total_paise: number
          refunded_paise: number
        }>
      >`SELECT id, order_number, order_status, payment_method, total_paise, refunded_paise FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) {
        throw new NotFoundException('Order not found')
      }

      const existingByKey = await tx.refund.findUnique({
        where: { idempotency_key: idempotencyKey },
      })
      if (existingByKey) {
        if (existingByKey.order_id !== order.id) {
          throw new ConflictException('Idempotency-Key was already used on a different order')
        }
        if (dto.amountPaise !== undefined && dto.amountPaise !== existingByKey.amount_paise) {
          throw new ConflictException(
            'Idempotency-Key was already used with a different refund amount',
          )
        }
        const activeRefunds = await tx.refund.findMany({
          where: { order_id: order.id, status: { in: ['PENDING', 'PROCESSED'] } },
          select: { amount_paise: true },
        })
        const committed = Math.max(
          order.refunded_paise,
          activeRefunds.reduce((sum, r) => sum + r.amount_paise, 0),
        )
        return {
          kind: 'REPLAY' as const,
          response: adminRefundOrderResponseSchema.parse({
            refundId: existingByKey.id,
            orderId: order.id,
            orderNumber: order.order_number,
            amountPaise: existingByKey.amount_paise,
            status: existingByKey.status as 'PENDING' | 'PROCESSED' | 'FAILED',
            gatewayRefundId: existingByKey.gateway_refund_id,
            remainingRefundablePaise: Math.max(0, order.total_paise - committed),
          }),
        }
      }

      if (order.payment_method !== PrismaPaymentMethod.ONLINE) {
        throw new BadRequestException('Only online paid orders support gateway refunds')
      }

      const capturedPayment = await tx.payment.findFirst({
        where: {
          order_id: order.id,
          gateway_payment_id: { not: null },
          status: {
            in: [PrismaPaymentStatus.CAPTURED, PrismaPaymentStatus.PARTIALLY_REFUNDED],
          },
        },
        orderBy: { created_at: 'desc' },
      })
      if (!capturedPayment?.gateway_payment_id) {
        throw new BadRequestException('Order does not have a captured payment eligible for refund')
      }

      const activeRefunds = await tx.refund.findMany({
        where: {
          order_id: order.id,
          status: { in: ['PENDING', 'PROCESSED'] },
        },
        select: { amount_paise: true },
      })
      const committedPaise = Math.max(
        order.refunded_paise,
        activeRefunds.reduce((sum, r) => sum + r.amount_paise, 0),
      )
      const remainingBefore = Math.max(0, order.total_paise - committedPaise)

      if (remainingBefore <= 0) {
        throw new BadRequestException('Order has no remaining refundable balance')
      }

      const requestedAmount = dto.amountPaise ?? remainingBefore
      if (requestedAmount > remainingBefore) {
        throw new BadRequestException(
          `Refund amount (${requestedAmount} paise) exceeds remaining refundable balance (${remainingBefore} paise)`,
        )
      }

      const createdRefund = await tx.refund.create({
        data: {
          order_id: order.id,
          payment_id: capturedPayment.id,
          idempotency_key: idempotencyKey,
          amount_paise: requestedAmount,
          status: 'PENDING',
          reason: dto.reason,
          initiated_by: `admin:${admin.email}`,
        },
      })

      await tx.auditLog.create({
        data: {
          admin_id: admin.id,
          action: 'ORDER_REFUND_INITIATED',
          entity: 'Order',
          entity_id: order.id,
          before: { refundedPaise: order.refunded_paise, committedPaise },
          after: {
            refundId: createdRefund.id,
            amountPaise: requestedAmount,
            reason: dto.reason,
          },
        },
      })

      return {
        kind: 'CREATED' as const,
        refundId: createdRefund.id,
        orderId: order.id,
        orderNumber: order.order_number,
        orderStatus: order.order_status,
        gatewayPaymentId: capturedPayment.gateway_payment_id,
        amountPaise: requestedAmount,
        remainingAfterCommit: Math.max(0, remainingBefore - requestedAmount),
        remainingBefore,
      }
    })

    if (prep.kind === 'REPLAY') {
      return prep.response
    }

    const gwResult = await this.paymentGateway.refundCapturedPayment({
      gatewayPaymentId: prep.gatewayPaymentId,
      amountPaise: prep.amountPaise,
      reason: dto.reason,
    })

    if (gwResult.refunded) {
      await this.prisma.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: prep.refundId },
          data: { gateway_refund_id: gwResult.refundId },
        })
        await tx.orderEvent.create({
          data: {
            order_id: prep.orderId,
            status: prep.orderStatus,
            note: `Refund initiated (${gwResult.refundId ?? prep.refundId}: ${prep.amountPaise} paise): ${dto.reason}. Awaiting refund.processed webhook.`,
            actor: `admin:${admin.email}`,
          },
        })
      })

      return adminRefundOrderResponseSchema.parse({
        refundId: prep.refundId,
        orderId: prep.orderId,
        orderNumber: prep.orderNumber,
        amountPaise: prep.amountPaise,
        status: 'PENDING',
        gatewayRefundId: gwResult.refundId,
        remainingRefundablePaise: prep.remainingAfterCommit,
      })
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: prep.refundId },
        data: { status: 'FAILED' },
      })
      await tx.order.update({
        where: { id: prep.orderId },
        data: { needs_attention: true },
      })
      await tx.orderEvent.create({
        data: {
          order_id: prep.orderId,
          status: prep.orderStatus,
          note: `Admin refund initiation failed (${prep.amountPaise} paise): ${gwResult.error ?? 'unknown error'}`,
          actor: `admin:${admin.email}`,
        },
      })
    })

    await this.opsAlertService.alertCritical({
      alertKey: 'admin-refund-gateway-failed',
      severity: 'CRITICAL',
      orderId: prep.orderId,
      message: `Admin refund initiation FAILED on ${prep.orderNumber} (${prep.amountPaise} paise): ${gwResult.error ?? 'unknown error'}`,
      details: { refundId: prep.refundId, amountPaise: prep.amountPaise },
    })

    return adminRefundOrderResponseSchema.parse({
      refundId: prep.refundId,
      orderId: prep.orderId,
      orderNumber: prep.orderNumber,
      amountPaise: prep.amountPaise,
      status: 'FAILED',
      gatewayRefundId: null,
      remainingRefundablePaise: prep.remainingBefore,
    })
  }

  /**
   * Explicitly records inspected physical return stock after delivery/pickup/refund:
   * - SEALED_RESTOCK restores stock (+qty, StockMovement RETURN_RESTOCK)
   * - DAMAGED_WRITEOFF logs audit write-off without increasing sellable stock (delta 0, RETURN_WRITEOFF)
   */
  async returnOrderStock(
    orderId: string,
    adminEmail: string | undefined,
    dto: AdminReturnStockDto,
  ): Promise<AdminReturnStockResponseDto> {
    const admin = await this.resolveActiveAdmin(adminEmail)

    const outcome = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{ id: string; order_number: string; order_status: PrismaOrderStatus }>
      >`SELECT id, order_number, order_status FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) {
        throw new NotFoundException('Order not found')
      }

      if (!RETURN_ELIGIBLE_ORDER_STATUSES.has(order.order_status)) {
        throw new BadRequestException(
          `Cannot process physical return stock for order in status ${order.order_status}; use /cancel before shipment`,
        )
      }

      const items = await tx.orderItem.findMany({
        where: { order_id: order.id },
      })
      const orderedQtyByVariant = new Map<string, number>()
      for (const item of items) {
        orderedQtyByVariant.set(
          item.variant_id,
          (orderedQtyByVariant.get(item.variant_id) ?? 0) + item.qty,
        )
      }

      const priorReturnMovements = await tx.stockMovement.findMany({
        where: {
          order_id: order.id,
          reason: {
            in: [
              STOCK_MOVEMENT_REASON.RETURN_RESTOCK,
              STOCK_MOVEMENT_REASON.RETURN_WRITEOFF,
              STOCK_MOVEMENT_REASON.CANCEL,
            ],
          },
        },
        select: { variant_id: true, delta: true, reason: true },
      })
      if (priorReturnMovements.some((m) => m.reason === STOCK_MOVEMENT_REASON.CANCEL)) {
        throw new ConflictException('Pre-shipment cancel already restored stock for this order')
      }

      const requestedQtyByVariant = new Map<string, number>()
      for (const line of dto.items) {
        const orderedQty = orderedQtyByVariant.get(line.variantId) ?? 0
        if (orderedQty === 0) {
          throw new BadRequestException(
            `Variant ${line.variantId} is not part of order ${order.order_number}`,
          )
        }
        requestedQtyByVariant.set(
          line.variantId,
          (requestedQtyByVariant.get(line.variantId) ?? 0) + line.qty,
        )
      }

      for (const [variantId, reqQty] of requestedQtyByVariant.entries()) {
        const orderedQty = orderedQtyByVariant.get(variantId) ?? 0
        if (reqQty > orderedQty) {
          throw new BadRequestException(
            `Returned quantity (${reqQty}) exceeds ordered quantity (${orderedQty}) for variant ${variantId}`,
          )
        }
      }

      const restockVariantIds = Array.from(
        new Set(
          dto.items
            .filter((line) => line.condition === 'SEALED_RESTOCK')
            .map((line) => line.variantId),
        ),
      ).sort()
      if (restockVariantIds.length > 0) {
        await tx.$queryRaw`
          SELECT id FROM variants WHERE id = ANY(${restockVariantIds}::text[]) ORDER BY id ASC FOR UPDATE
        `
      }

      let restockedUnits = 0
      let writtenOffUnits = 0

      for (const line of dto.items) {
        if (line.condition === 'SEALED_RESTOCK') {
          await tx.variant.update({
            where: { id: line.variantId },
            data: { stock: { increment: line.qty } },
          })
          await tx.stockMovement.create({
            data: {
              variant_id: line.variantId,
              delta: line.qty,
              reason: STOCK_MOVEMENT_REASON.RETURN_RESTOCK,
              order_id: order.id,
              actor: `admin:${admin.email}`,
            },
          })
          restockedUnits += line.qty
        } else {
          await tx.stockMovement.create({
            data: {
              variant_id: line.variantId,
              delta: 0,
              reason: STOCK_MOVEMENT_REASON.RETURN_WRITEOFF,
              order_id: order.id,
              actor: `admin:${admin.email}`,
            },
          })
          writtenOffUnits += line.qty
        }
      }

      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: order.order_status,
          note: `Physical return processed (${restockedUnits} sealed restocked, ${writtenOffUnits} damaged write-offs): ${dto.reason}`,
          actor: `admin:${admin.email}`,
        },
      })

      await tx.auditLog.create({
        data: {
          admin_id: admin.id,
          action: 'ORDER_RETURN_STOCK',
          entity: 'Order',
          entity_id: order.id,
          after: {
            restockedUnits,
            writtenOffUnits,
            items: dto.items as unknown as Prisma.InputJsonValue,
            reason: dto.reason,
          },
        },
      })

      return {
        orderId: order.id,
        restockedUnits,
        writtenOffUnits,
        restockVariantIds,
      }
    })

    if (outcome.restockVariantIds.length > 0) {
      await this.productCacheService.invalidateProductCache(undefined, outcome.restockVariantIds)
    }

    return adminReturnStockResponseSchema.parse({
      orderId: outcome.orderId,
      restockedUnits: outcome.restockedUnits,
      writtenOffUnits: outcome.writtenOffUnits,
    })
  }

  /**
   * Transitions a CONFIRMED order to PACKED and enqueues the packed notification.
   */
  async packOrder(
    orderId: string,
    adminEmail: string | undefined,
    dto: AdminPackOrderDto,
  ): Promise<AdminOrderTransitionResponseDto> {
    const admin = await this.resolveActiveAdmin(adminEmail)

    const result = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          order_status: PrismaOrderStatus
          fulfilment_method: PrismaFulfilmentMethod
        }>
      >`SELECT id, order_number, order_status, fulfilment_method FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) throw new NotFoundException('Order not found')

      if (order.order_status === PrismaOrderStatus.PACKED) {
        throw new ConflictException('Order is already marked PACKED')
      }

      if (
        !canTransitionOrderStatus(
          order.order_status as OrderStatus,
          ORDER_STATUS.PACKED,
          order.fulfilment_method,
        )
      ) {
        throw new BadRequestException(`Cannot pack order in status ${order.order_status}`)
      }

      const note = dto.note?.trim() || 'Order freshly milled and packed'
      await tx.order.update({
        where: { id: order.id },
        data: { order_status: PrismaOrderStatus.PACKED },
      })
      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: PrismaOrderStatus.PACKED,
          note,
          actor: `admin:${admin.email}`,
        },
      })
      await tx.auditLog.create({
        data: {
          admin_id: admin.id,
          action: 'ORDER_PACKED',
          entity: 'Order',
          entity_id: order.id,
          before: { orderStatus: order.order_status },
          after: { orderStatus: ORDER_STATUS.PACKED, note },
        },
      })

      return order
    })

    void this.queueService.enqueueCustomerNotification({
      event: 'ORDER_PACKED',
      orderId: result.id,
      orderNumber: result.order_number,
      message: `Order ${result.order_number} packed`,
    })

    return adminOrderTransitionResponseSchema.parse({
      orderId: result.id,
      orderNumber: result.order_number,
      orderStatus: 'PACKED',
    })
  }

  /**
   * Transitions a PACKED DELIVERY order to SHIPPED, saves tracking URL, and dispatches notification.
   */
  async shipOrder(
    orderId: string,
    adminEmail: string | undefined,
    dto: AdminShipOrderDto,
  ): Promise<AdminOrderTransitionResponseDto> {
    const admin = await this.resolveActiveAdmin(adminEmail)

    const result = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          order_status: PrismaOrderStatus
          fulfilment_method: PrismaFulfilmentMethod
        }>
      >`SELECT id, order_number, order_status, fulfilment_method FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) throw new NotFoundException('Order not found')

      if (order.order_status === PrismaOrderStatus.SHIPPED) {
        throw new ConflictException('Order is already shipped')
      }

      if (
        !canTransitionOrderStatus(
          order.order_status as OrderStatus,
          ORDER_STATUS.SHIPPED,
          order.fulfilment_method,
        )
      ) {
        throw new BadRequestException(`Cannot ship order in status ${order.order_status}`)
      }

      const trackingUrl = dto.trackingUrl?.trim() ?? null
      const note =
        dto.note?.trim() || (trackingUrl ? `Order shipped (${trackingUrl})` : 'Order dispatched')

      await tx.order.update({
        where: { id: order.id },
        data: {
          order_status: PrismaOrderStatus.SHIPPED,
          ...(trackingUrl ? { tracking_url: trackingUrl } : {}),
        },
      })
      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: PrismaOrderStatus.SHIPPED,
          note,
          actor: `admin:${admin.email}`,
        },
      })
      await tx.auditLog.create({
        data: {
          admin_id: admin.id,
          action: 'ORDER_SHIPPED',
          entity: 'Order',
          entity_id: order.id,
          before: { orderStatus: order.order_status },
          after: { orderStatus: ORDER_STATUS.SHIPPED, trackingUrl, note },
        },
      })

      return { order, trackingUrl }
    })

    void this.queueService.enqueueCustomerNotification({
      event: 'ORDER_SHIPPED',
      orderId: result.order.id,
      orderNumber: result.order.order_number,
      trackingUrl: result.trackingUrl,
      message: `Order ${result.order.order_number} shipped`,
    })

    return adminOrderTransitionResponseSchema.parse({
      orderId: result.order.id,
      orderNumber: result.order.order_number,
      orderStatus: 'SHIPPED',
      trackingUrl: result.trackingUrl,
    })
  }

  /**
   * Transitions a PACKED STORE_PICKUP order to READY_FOR_PICKUP:
   * generates a brand-new 6-digit HMAC pickup code, stores ONLY the hash, sets last collection date,
   * and sends SMS + Email with order number, code, store hours, and last collection date.
   */
  async markReadyForPickup(
    orderId: string,
    adminEmail: string | undefined,
  ): Promise<AdminOrderTransitionResponseDto> {
    const admin = await this.resolveActiveAdmin(adminEmail)
    const settings = await this.settingsService.getInternalPricingSettings()

    const now = new Date()
    const holdDays = Math.max(1, settings.holdWindowDays)
    const lastCollectionAt = new Date(now.getTime() + holdDays * 86_400_000)

    const result = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          order_status: PrismaOrderStatus
          fulfilment_method: PrismaFulfilmentMethod
        }>
      >`SELECT id, order_number, order_status, fulfilment_method FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) throw new NotFoundException('Order not found')

      if (order.order_status === PrismaOrderStatus.READY_FOR_PICKUP) {
        throw new ConflictException('Order is already marked READY_FOR_PICKUP')
      }

      if (
        !canTransitionOrderStatus(
          order.order_status as OrderStatus,
          ORDER_STATUS.READY_FOR_PICKUP,
          order.fulfilment_method,
        )
      ) {
        throw new BadRequestException(
          `Cannot mark order ready for pickup from status ${order.order_status}`,
        )
      }

      const codePair = this.checkoutSecurity.createPickupCodePair(order.id)

      await tx.order.update({
        where: { id: order.id },
        data: {
          order_status: PrismaOrderStatus.READY_FOR_PICKUP,
          pickup_code_hash: codePair.hmacHash,
          pickup_code_attempts: 0,
          pickup_code_locked_until: null,
          pickup_ready_at: now,
          pickup_last_collection_at: lastCollectionAt,
          pickup_code_last_sent_at: now,
        },
      })

      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: PrismaOrderStatus.READY_FOR_PICKUP,
          note: `Order ready for pickup; pickup verification code issued (collect by ${formatDateIndia(lastCollectionAt)})`,
          actor: `admin:${admin.email}`,
        },
      })

      await tx.auditLog.create({
        data: {
          admin_id: admin.id,
          action: 'ORDER_READY_FOR_PICKUP',
          entity: 'Order',
          entity_id: order.id,
          before: { orderStatus: order.order_status },
          after: {
            orderStatus: ORDER_STATUS.READY_FOR_PICKUP,
            lastCollectionDate: lastCollectionAt.toISOString(),
          },
        },
      })

      return { order, plaintextCode: codePair.plaintextCode }
    })

    void this.queueService.enqueueCustomerNotification({
      event: 'ORDER_READY_FOR_PICKUP',
      orderId: result.order.id,
      orderNumber: result.order.order_number,
      pickupCode: result.plaintextCode,
      message: `Order ${result.order.order_number} ready for pickup`,
    })

    return adminOrderTransitionResponseSchema.parse({
      orderId: result.order.id,
      orderNumber: result.order.order_number,
      orderStatus: 'READY_FOR_PICKUP',
      lastCollectionDate: formatDateIndia(lastCollectionAt),
    })
  }

  /**
   * Transitions a SHIPPED DELIVERY order to DELIVERED and notifies customer.
   */
  async markDelivered(
    orderId: string,
    adminEmail: string | undefined,
  ): Promise<AdminOrderTransitionResponseDto> {
    const admin = await this.resolveActiveAdmin(adminEmail)

    const result = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          order_status: PrismaOrderStatus
          fulfilment_method: PrismaFulfilmentMethod
        }>
      >`SELECT id, order_number, order_status, fulfilment_method FROM orders WHERE id = ${orderId} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) throw new NotFoundException('Order not found')

      if (order.order_status === PrismaOrderStatus.DELIVERED) {
        throw new ConflictException('Order is already DELIVERED')
      }

      if (
        !canTransitionOrderStatus(
          order.order_status as OrderStatus,
          ORDER_STATUS.DELIVERED,
          order.fulfilment_method,
        )
      ) {
        throw new BadRequestException(`Cannot mark delivered from status ${order.order_status}`)
      }

      await tx.order.update({
        where: { id: order.id },
        data: { order_status: PrismaOrderStatus.DELIVERED },
      })
      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: PrismaOrderStatus.DELIVERED,
          note: 'Order delivered to customer',
          actor: `admin:${admin.email}`,
        },
      })
      await tx.auditLog.create({
        data: {
          admin_id: admin.id,
          action: 'ORDER_DELIVERED',
          entity: 'Order',
          entity_id: order.id,
          before: { orderStatus: order.order_status },
          after: { orderStatus: ORDER_STATUS.DELIVERED },
        },
      })

      return order
    })

    void this.queueService.enqueueCustomerNotification({
      event: 'ORDER_DELIVERED',
      orderId: result.id,
      orderNumber: result.order_number,
      message: `Order ${result.order_number} delivered`,
    })

    return adminOrderTransitionResponseSchema.parse({
      orderId: result.id,
      orderNumber: result.order_number,
      orderStatus: 'DELIVERED',
    })
  }

  /**
   * Counter pickup verification (attempt-limited 6-digit pickup code OR orderNumber + photo ID fallback).
   * Transitions READY_FOR_PICKUP -> PICKED_UP and notifies customer cleanly.
   */
  async completeStorePickup(
    orderId: string,
    adminEmail: string | undefined,
    dto: AdminPickupCompleteDto,
  ): Promise<AdminOrderTransitionResponseDto> {
    const admin = await this.resolveActiveAdmin(adminEmail)

    const existing = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, order_number: true, order_status: true, fulfilment_method: true },
    })
    if (!existing) throw new NotFoundException('Order not found')
    if (existing.order_status === PrismaOrderStatus.PICKED_UP) {
      throw new ConflictException('Order was already picked up')
    }
    if (
      !canTransitionOrderStatus(
        existing.order_status as OrderStatus,
        ORDER_STATUS.PICKED_UP,
        existing.fulfilment_method,
      )
    ) {
      throw new BadRequestException(`Cannot complete pickup from status ${existing.order_status}`)
    }

    if (dto.pickupCode) {
      const check = await this.checkoutService.verifyPickupCodeAttempt(orderId, dto.pickupCode)
      if (!check.valid) {
        if (check.lockedUntil) {
          throw new HttpException(
            'Too many incorrect pickup code attempts. Verify order number with customer photo ID instead.',
            HttpStatus.TOO_MANY_REQUESTS,
          )
        }
        throw new BadRequestException(
          'Invalid pickup verification code. Retry or verify order number + photo ID.',
        )
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{ id: string; order_number: string; order_status: PrismaOrderStatus }>
      >`SELECT id, order_number, order_status FROM orders WHERE id = ${orderId} FOR UPDATE`
      const order = lockedOrders[0]
      if (!order) throw new NotFoundException('Order not found')

      if (order.order_status !== PrismaOrderStatus.READY_FOR_PICKUP) {
        throw new ConflictException(`Order status changed to ${order.order_status}`)
      }

      const now = new Date()
      const note = dto.pickupCode
        ? 'Store pickup verified via 6-digit pickup code'
        : `Store pickup verified via order number + photo ID fallback: ${dto.photoIdFallbackNote}`

      await tx.order.update({
        where: { id: order.id },
        data: {
          order_status: PrismaOrderStatus.PICKED_UP,
          picked_up_at: now,
        },
      })
      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: PrismaOrderStatus.PICKED_UP,
          note,
          actor: `admin:${admin.email}`,
        },
      })
      await tx.auditLog.create({
        data: {
          admin_id: admin.id,
          action: 'ORDER_PICKED_UP',
          entity: 'Order',
          entity_id: order.id,
          before: { orderStatus: order.order_status },
          after: {
            orderStatus: ORDER_STATUS.PICKED_UP,
            verificationMethod: dto.pickupCode ? 'PICKUP_CODE' : 'PHOTO_ID_FALLBACK',
            note,
          },
        },
      })
      return order
    })

    void this.queueService.enqueueCustomerNotification({
      event: 'ORDER_PICKED_UP',
      orderId: updated.id,
      orderNumber: updated.order_number,
      message: `Order ${updated.order_number} picked up`,
    })

    return adminOrderTransitionResponseSchema.parse({
      orderId: updated.id,
      orderNumber: updated.order_number,
      orderStatus: 'PICKED_UP',
    })
  }

  /**
   * Customer self-service pickup code rotation after OTP verification.
   * Invalidates earlier codes immediately, enforces reissue cap/cooldown, and never logs plaintext code.
   */
  async reissuePickupCode(
    dto: PickupCodeReissueRequestDto,
    context: { ip: string; sessionId: string },
  ): Promise<PickupCodeReissueResponseDto> {
    if (!this.settingsService.isSmsOtpReady()) {
      throw new ServiceUnavailableException('SMS service is unavailable for pickup code reissue')
    }

    const now = new Date()
    const result = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          order_status: PrismaOrderStatus
          fulfilment_method: PrismaFulfilmentMethod
          customer_id: string
          pickup_last_collection_at: Date | null
          pickup_code_reissue_count: number
          pickup_code_last_sent_at: Date | null
        }>
      >`SELECT id, order_number, order_status, fulfilment_method, customer_id, pickup_last_collection_at, pickup_code_reissue_count, pickup_code_last_sent_at FROM orders WHERE order_number = ${dto.orderNumber} FOR UPDATE`

      const order = lockedOrders[0]
      if (!order) {
        throw new NotFoundException('Matching order not found')
      }

      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: order.customer_id },
        select: { phone: true, email: true },
      })
      if (customer.phone !== dto.phone) {
        throw new ForbiddenException('Phone number does not match order record')
      }

      if (
        order.fulfilment_method !== PrismaFulfilmentMethod.STORE_PICKUP ||
        order.order_status !== PrismaOrderStatus.READY_FOR_PICKUP
      ) {
        throw new BadRequestException(
          'Pickup verification code is only issued once the store order is ready for pickup',
        )
      }

      if (order.pickup_code_reissue_count >= OTP_CONSTANTS.PICKUP_CODE_REISSUE_MAX) {
        throw new HttpException(
          'Maximum pickup code reissue limit reached for this order. Collect at counter using your order number and photo ID.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }

      if (
        order.pickup_code_last_sent_at &&
        now.getTime() - order.pickup_code_last_sent_at.getTime() <
          OTP_CONSTANTS.PICKUP_CODE_REISSUE_COOLDOWN_SECONDS * 1000
      ) {
        throw new HttpException(
          `Please wait ${OTP_CONSTANTS.PICKUP_CODE_REISSUE_COOLDOWN_SECONDS} seconds before requesting another pickup code.`,
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }

      await this.otpService.consumeVerificationTokenInTx(tx, {
        token: dto.verificationToken,
        phone: dto.phone,
        purpose: OTP_PURPOSE.PICKUP_CODE_REISSUE,
        sessionId: context.sessionId,
      })

      const codePair = this.checkoutSecurity.createPickupCodePair(order.id)
      const nextCount = order.pickup_code_reissue_count + 1

      await tx.order.update({
        where: { id: order.id },
        data: {
          pickup_code_hash: codePair.hmacHash,
          pickup_code_attempts: 0,
          pickup_code_locked_until: null,
          pickup_code_reissue_count: nextCount,
          pickup_code_last_sent_at: now,
        },
      })

      await tx.orderEvent.create({
        data: {
          order_id: order.id,
          status: PrismaOrderStatus.READY_FOR_PICKUP,
          note: `Customer requested fresh pickup verification code (#${nextCount}; earlier code invalidated)`,
          actor: 'customer:otp',
        },
      })

      return {
        orderId: order.id,
        orderNumber: order.order_number,
        plaintextCode: codePair.plaintextCode,
        phone: customer.phone,
        email: customer.email,
        lastCollectionDate: order.pickup_last_collection_at
          ? formatDateIndia(order.pickup_last_collection_at)
          : formatDateIndia(new Date(now.getTime() + 3 * 86_400_000)),
      }
    })

    void this.queueService.enqueueCustomerNotification({
      event: 'PICKUP_CODE_REISSUED',
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      pickupCode: result.plaintextCode,
      message: `Rotated pickup code for ${result.orderNumber}`,
    })

    return pickupCodeReissueResponseSchema.parse({
      orderNumber: result.orderNumber,
      sent: true,
      maskedPhone: maskPhone(result.phone),
      maskedEmail: result.email ? maskEmail(result.email) : null,
      lastCollectionDate: result.lastCollectionDate,
    })
  }

  /**
   * Non-production staging helper to test owner operational alerts end-to-end.
   */
  async triggerTestOwnerAlert(
    adminEmail: string | undefined,
    dto: AdminTestAlertDto,
  ): Promise<AdminTestAlertResponseDto> {
    const admin = await this.resolveActiveAdmin(adminEmail)
    const alertKey = 'manual-test-alert'

    await this.prisma.auditLog.create({
      data: {
        admin_id: admin.id,
        action: 'TEST_OPS_ALERT',
        entity: 'Alert',
        entity_id: alertKey,
        after: { severity: dto.severity, message: dto.message ?? null },
      },
    })

    await this.opsAlertService.alertCritical({
      alertKey,
      severity: dto.severity,
      message:
        dto.message?.trim() ||
        `Staging test ${dto.severity} operational alert triggered by ${admin.email}`,
      bypassThrottle: true,
    })

    return adminTestAlertResponseSchema.parse({
      sent: true,
      severity: dto.severity,
      alertKey,
      channels: {
        log: true,
        emailRecipients: dto.severity === ALERT_SEVERITY.INFO ? 0 : env.OWNER_ALERT_EMAIL.length,
        smsRecipients: dto.severity === ALERT_SEVERITY.CRITICAL ? env.OWNER_ALERT_PHONE.length : 0,
        externalWebhook:
          dto.severity === ALERT_SEVERITY.CRITICAL && Boolean(env.UPTIME_ALERT_WEBHOOK_URL),
        sentry: dto.severity !== ALERT_SEVERITY.INFO && Boolean(env.SENTRY_DSN),
      },
    })
  }
}
