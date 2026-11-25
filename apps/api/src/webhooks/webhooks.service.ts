import { createHash } from 'node:crypto'
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import {
  OrderStatus as PrismaOrderStatus,
  PaymentStatus as PrismaPaymentStatus,
  Prisma,
  ReservationStatus as PrismaReservationStatus,
} from '@prisma/client'
import {
  MAX_ONLINE_PAYMENT_FAILED_ATTEMPTS,
  type WebhookAckResponseDto,
  webhookAckResponseSchema,
} from '@pressedoils/shared'
import { CheckoutService } from '../checkout/checkout.service'
import { PaymentGatewayService } from '../checkout/payment-gateway.service'
import { PrismaService } from '../prisma/prisma.service'
import { OpsAlertService } from '../queue/ops-alert.service'
import { QueueService } from '../queue/queue.service'

interface RazorpayWebhookPayload {
  id?: string
  event?: string
  created_at?: number
  payload?: {
    payment?: {
      entity?: {
        id?: string
        order_id?: string
        amount?: number
        currency?: string
        status?: string
        error_code?: string
        error_description?: string
        error_reason?: string
        notes?: Record<string, string>
      }
    }
    order?: {
      entity?: {
        id?: string
        amount?: number
        currency?: string
        notes?: Record<string, string>
      }
    }
    refund?: {
      entity?: {
        id?: string
        payment_id?: string
        amount?: number
        currency?: string
        status?: string
        notes?: Record<string, string>
      }
    }
  }
}

const UNSHIPPED_ALERT_ORDER_STATUSES = new Set<PrismaOrderStatus>([
  PrismaOrderStatus.PAID,
  PrismaOrderStatus.CONFIRMED,
  PrismaOrderStatus.PACKED,
  PrismaOrderStatus.READY_FOR_PICKUP,
])

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGatewayService,
    private readonly checkoutService: CheckoutService,
    private readonly queueService: QueueService,
    private readonly opsAlertService: OpsAlertService,
  ) {}

  /**
   * Handles incoming Razorpay webhooks:
   * 1. Verifies X-Razorpay-Signature over the EXACT raw request body BEFORE JSON parsing (4xx on failure).
   * 2. Persists every verified event in webhook_events first, deduping cleanly on event_id.
   * 3. Processes payment.captured / order.paid / payment.failed / refund.processed / refund.failed inline.
   */
  async handleRazorpayWebhook(input: {
    rawBody: Buffer | undefined
    signature: string | undefined
    eventIdHeader: string | undefined
  }): Promise<WebhookAckResponseDto> {
    if (!input.rawBody || !Buffer.isBuffer(input.rawBody) || input.rawBody.length === 0) {
      throw new BadRequestException('Webhook raw request body is required')
    }

    const signatureValid = this.paymentGateway.verifyWebhookSignature(
      input.rawBody,
      input.signature,
    )
    if (!signatureValid) {
      this.logger.warn({
        event: 'RAZORPAY_WEBHOOK_INVALID_SIGNATURE',
        hasSignature: Boolean(input.signature),
      })
      throw new UnauthorizedException('Invalid Razorpay webhook signature')
    }

    let payload: RazorpayWebhookPayload
    try {
      payload = JSON.parse(input.rawBody.toString('utf8')) as RazorpayWebhookPayload
    } catch {
      throw new BadRequestException('Invalid webhook JSON payload')
    }

    const payloadHash = createHash('sha256').update(input.rawBody).digest('hex')
    const eventId =
      input.eventIdHeader?.trim() ||
      (typeof payload.id === 'string' && payload.id.trim().length > 0
        ? payload.id.trim()
        : `evt_sha256_${payloadHash.slice(0, 32)}`)
    const eventType = typeof payload.event === 'string' ? payload.event : 'unknown'

    // Persist verified webhook event FIRST inside webhook_events with unique event_id constraint
    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: 'razorpay',
          event_id: eventId,
          event_type: eventType,
          payload_hash: payloadHash,
          status: 'RECEIVED',
          raw_payload: payload as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return webhookAckResponseSchema.parse({
          received: true,
          duplicate: true,
          eventId,
          outcome: 'DUPLICATE',
        })
      }
      throw err
    }

    try {
      if (eventType === 'payment.captured' || eventType === 'order.paid') {
        return await this.processPaymentCaptured(eventId, payload)
      }

      if (eventType === 'payment.failed') {
        return await this.processPaymentFailed(eventId, payload)
      }

      if (eventType === 'refund.processed') {
        return await this.processRefundProcessed(eventId, payload)
      }

      if (eventType === 'refund.failed') {
        return await this.processRefundFailed(eventId, payload)
      }

      await this.prisma.webhookEvent.update({
        where: { event_id: eventId },
        data: { status: 'IGNORED', processed_at: new Date() },
      })

      return webhookAckResponseSchema.parse({
        received: true,
        duplicate: false,
        eventId,
        outcome: 'IGNORED',
      })
    } catch (err) {
      await this.prisma.webhookEvent
        .update({
          where: { event_id: eventId },
          data: {
            status: 'ERROR',
            error_message:
              err instanceof Error ? err.message.slice(0, 500) : 'unknown webhook error',
          },
        })
        .catch(() => undefined)
      throw err
    }
  }

  private async resolveOrderForPaymentEvent(input: {
    gatewayOrderId?: string
    gatewayPaymentId?: string
    internalOrderIdNote?: string
  }) {
    if (input.gatewayPaymentId) {
      const byPayment = await this.prisma.payment.findUnique({
        where: { gateway_payment_id: input.gatewayPaymentId },
        select: { order_id: true },
      })
      if (byPayment) {
        return this.prisma.order.findUnique({ where: { id: byPayment.order_id } })
      }
    }

    if (input.gatewayOrderId) {
      const byGatewayOrder = await this.prisma.payment.findFirst({
        where: { gateway_order_id: input.gatewayOrderId },
        select: { order_id: true },
      })
      if (byGatewayOrder) {
        return this.prisma.order.findUnique({ where: { id: byGatewayOrder.order_id } })
      }
    }

    if (input.internalOrderIdNote) {
      return this.prisma.order.findUnique({ where: { id: input.internalOrderIdNote } })
    }

    return null
  }

  private async processPaymentCaptured(
    eventId: string,
    payload: RazorpayWebhookPayload,
  ): Promise<WebhookAckResponseDto> {
    const paymentEntity = payload.payload?.payment?.entity
    const orderEntity = payload.payload?.order?.entity

    const gatewayOrderId = paymentEntity?.order_id ?? orderEntity?.id
    const gatewayPaymentId = paymentEntity?.id
    const internalOrderIdNote =
      paymentEntity?.notes?.internal_order_id ?? orderEntity?.notes?.internal_order_id
    const actualAmountPaise =
      typeof paymentEntity?.amount === 'number'
        ? paymentEntity.amount
        : typeof orderEntity?.amount === 'number'
          ? orderEntity.amount
          : null
    const actualCurrency = paymentEntity?.currency ?? orderEntity?.currency ?? null

    const order = await this.resolveOrderForPaymentEvent({
      gatewayOrderId,
      gatewayPaymentId,
      internalOrderIdNote,
    })

    if (!order || !gatewayOrderId || !gatewayPaymentId) {
      this.logger.warn({
        event: 'RAZORPAY_WEBHOOK_UNKNOWN_ORDER',
        eventId,
        gatewayOrderId: gatewayOrderId ?? null,
        gatewayPaymentId: gatewayPaymentId ?? null,
      })
      await this.prisma.webhookEvent.update({
        where: { event_id: eventId },
        data: {
          status: 'IGNORED',
          error_message: 'Unknown gateway order ID',
          processed_at: new Date(),
        },
      })
      return webhookAckResponseSchema.parse({
        received: true,
        duplicate: false,
        eventId,
        outcome: 'IGNORED',
      })
    }

    if (actualAmountPaise !== order.total_paise || actualCurrency !== 'INR') {
      await this.checkoutService.flagPaymentAmountMismatch({
        orderId: order.id,
        gatewayOrderId,
        gatewayPaymentId,
        actualAmountPaise,
        actualCurrency,
        rawPayload: payload,
        source: 'webhook',
      })
      await this.prisma.webhookEvent.update({
        where: { event_id: eventId },
        data: {
          order_id: order.id,
          status: 'MISMATCH_ALERTED',
          error_message: `Amount/currency mismatch: received=${actualAmountPaise} ${actualCurrency}, expected=${order.total_paise} INR`,
          processed_at: new Date(),
        },
      })
      return webhookAckResponseSchema.parse({
        received: true,
        duplicate: false,
        eventId,
        outcome: 'MISMATCH_ALERTED',
      })
    }

    await this.checkoutService.markOrderPaid({
      orderId: order.id,
      gatewayOrderId,
      gatewayPaymentId,
      rawPayload: payload,
      source: 'webhook',
    })

    await this.prisma.webhookEvent.update({
      where: { event_id: eventId },
      data: {
        order_id: order.id,
        status: 'PROCESSED',
        processed_at: new Date(),
      },
    })

    return webhookAckResponseSchema.parse({
      received: true,
      duplicate: false,
      eventId,
      outcome: 'PROCESSED',
    })
  }

  private async processPaymentFailed(
    eventId: string,
    payload: RazorpayWebhookPayload,
  ): Promise<WebhookAckResponseDto> {
    const paymentEntity = payload.payload?.payment?.entity
    const gatewayOrderId = paymentEntity?.order_id
    const gatewayPaymentId = paymentEntity?.id
    const internalOrderIdNote = paymentEntity?.notes?.internal_order_id

    const order = await this.resolveOrderForPaymentEvent({
      gatewayOrderId,
      gatewayPaymentId,
      internalOrderIdNote,
    })

    if (!order) {
      this.logger.warn({
        event: 'RAZORPAY_PAYMENT_FAILED_UNKNOWN_ORDER',
        eventId,
        gatewayOrderId: gatewayOrderId ?? null,
      })
      await this.prisma.webhookEvent.update({
        where: { event_id: eventId },
        data: {
          status: 'IGNORED',
          error_message: 'Unknown gateway order ID',
          processed_at: new Date(),
        },
      })
      return webhookAckResponseSchema.parse({
        received: true,
        duplicate: false,
        eventId,
        outcome: 'IGNORED',
      })
    }

    const txResult = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_status: PrismaOrderStatus
          total_paise: number
          failed_payment_attempts: number
        }>
      >`SELECT id, order_status, total_paise, failed_payment_attempts FROM orders WHERE id = ${order.id} FOR UPDATE`
      const locked = lockedOrders[0]
      if (!locked) {
        return { shouldCheckRelease: false, gatewayOrderId: gatewayOrderId ?? null }
      }

      if (gatewayPaymentId) {
        const existingFailed = await tx.payment.findUnique({
          where: { gateway_payment_id: gatewayPaymentId },
          select: { id: true },
        })
        if (!existingFailed) {
          await tx.payment.create({
            data: {
              order_id: locked.id,
              gateway: this.paymentGateway.getMode(),
              gateway_order_id: gatewayOrderId ?? null,
              gateway_payment_id: gatewayPaymentId,
              amount_paise:
                typeof paymentEntity?.amount === 'number'
                  ? paymentEntity.amount
                  : locked.total_paise,
              status: PrismaPaymentStatus.FAILED,
              raw_payload: payload as unknown as Prisma.InputJsonValue,
            },
          })
        }
      }

      const nextAttempts = locked.failed_payment_attempts + 1
      await tx.order.update({
        where: { id: locked.id },
        data: { failed_payment_attempts: nextAttempts },
      })

      const reasonSummary = [paymentEntity?.error_code, paymentEntity?.error_description]
        .filter(Boolean)
        .join(': ')

      await tx.orderEvent.create({
        data: {
          order_id: locked.id,
          status: locked.order_status,
          note: `Gateway payment failed attempt #${nextAttempts}${gatewayPaymentId ? ` (${gatewayPaymentId})` : ''}${reasonSummary ? ` — ${reasonSummary}` : ''}`,
          actor: 'webhook:payment.failed',
        },
      })

      return {
        shouldCheckRelease:
          locked.order_status === PrismaOrderStatus.PENDING_PAYMENT &&
          nextAttempts >= MAX_ONLINE_PAYMENT_FAILED_ATTEMPTS,
        gatewayOrderId: gatewayOrderId ?? null,
      }
    })

    // Leave reservation intact for retry unless the failed-attempt cap is reached AND gateway has no authorized/captured payment
    if (txResult.shouldCheckRelease) {
      let safeToRelease = true
      if (txResult.gatewayOrderId) {
        const gwStatus = await this.paymentGateway.fetchOrderPaymentStatus(txResult.gatewayOrderId)
        if (gwStatus.status === 'captured' && gwStatus.capturedPaymentId) {
          safeToRelease = false
          if (
            gwStatus.capturedAmountPaise !== null &&
            gwStatus.capturedAmountPaise !== order.total_paise
          ) {
            await this.checkoutService.flagPaymentAmountMismatch({
              orderId: order.id,
              gatewayOrderId: txResult.gatewayOrderId,
              gatewayPaymentId: gwStatus.capturedPaymentId,
              actualAmountPaise: gwStatus.capturedAmountPaise,
              actualCurrency: 'INR',
              rawPayload: gwStatus.raw,
              source: 'payment-failed-cap',
            })
          } else {
            await this.checkoutService.markOrderPaid({
              orderId: order.id,
              gatewayOrderId: txResult.gatewayOrderId,
              gatewayPaymentId: gwStatus.capturedPaymentId,
              rawPayload: gwStatus.raw,
              source: 'reconcile',
            })
          }
        } else if (gwStatus.status === 'authorized') {
          safeToRelease = false
        }
      }

      if (safeToRelease) {
        await this.checkoutService.releaseOrderReservationOnCancel(
          order.id,
          'MAX_FAILED_ATTEMPTS',
          `Released reservation after ${MAX_ONLINE_PAYMENT_FAILED_ATTEMPTS} failed online payment attempts`,
          PrismaReservationStatus.RELEASED,
        )
      }
    }

    await this.prisma.webhookEvent.update({
      where: { event_id: eventId },
      data: {
        order_id: order.id,
        status: 'PROCESSED',
        processed_at: new Date(),
      },
    })

    return webhookAckResponseSchema.parse({
      received: true,
      duplicate: false,
      eventId,
      outcome: 'RECORDED',
    })
  }

  private async processRefundProcessed(
    eventId: string,
    payload: RazorpayWebhookPayload,
  ): Promise<WebhookAckResponseDto> {
    const refundEntity = payload.payload?.refund?.entity
    const paymentEntity = payload.payload?.payment?.entity
    const gatewayRefundId = refundEntity?.id
    const gatewayPaymentId = refundEntity?.payment_id ?? paymentEntity?.id
    const amountPaise = typeof refundEntity?.amount === 'number' ? refundEntity.amount : null

    const payment = gatewayPaymentId
      ? await this.prisma.payment.findUnique({
          where: { gateway_payment_id: gatewayPaymentId },
          select: { id: true, order_id: true },
        })
      : null

    if (!payment || !gatewayRefundId || !amountPaise || amountPaise <= 0) {
      this.logger.warn({
        event: 'RAZORPAY_REFUND_WEBHOOK_UNKNOWN_PAYMENT',
        eventId,
        gatewayRefundId: gatewayRefundId ?? null,
        gatewayPaymentId: gatewayPaymentId ?? null,
      })
      await this.prisma.webhookEvent.update({
        where: { event_id: eventId },
        data: {
          status: 'IGNORED',
          error_message: 'Unknown payment reference or invalid refund amount',
          processed_at: new Date(),
        },
      })
      return webhookAckResponseSchema.parse({
        received: true,
        duplicate: false,
        eventId,
        outcome: 'IGNORED',
      })
    }

    const txOutcome = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string
          order_number: string
          total_paise: number
          refunded_paise: number
          order_status: PrismaOrderStatus
          payment_status: PrismaPaymentStatus
        }>
      >`SELECT id, order_number, total_paise, refunded_paise, order_status, payment_status FROM orders WHERE id = ${payment.order_id} FOR UPDATE`

      const lockedOrder = lockedOrders[0]
      if (!lockedOrder) {
        return { kind: 'UNKNOWN' as const }
      }

      const existingRefund = await tx.refund.findUnique({
        where: { gateway_refund_id: gatewayRefundId },
      })

      if (existingRefund && existingRefund.status === 'PROCESSED') {
        return { kind: 'ALREADY_HANDLED' as const, orderId: lockedOrder.id }
      }

      const originatedInternally = Boolean(
        existingRefund && existingRefund.initiated_by !== 'razorpay:dashboard',
      )

      if (existingRefund) {
        await tx.refund.update({
          where: { id: existingRefund.id },
          data: {
            status: 'PROCESSED',
            raw_payload: payload as unknown as Prisma.InputJsonValue,
          },
        })
      } else {
        await tx.refund.create({
          data: {
            order_id: lockedOrder.id,
            payment_id: payment.id,
            gateway_refund_id: gatewayRefundId,
            amount_paise: amountPaise,
            status: 'PROCESSED',
            reason: 'Gateway refund.processed webhook (dashboard/external)',
            initiated_by: 'razorpay:dashboard',
            raw_payload: payload as unknown as Prisma.InputJsonValue,
          },
        })
      }

      const nextRefundedPaise = lockedOrder.refunded_paise + amountPaise
      const isFullRefund = nextRefundedPaise >= lockedOrder.total_paise
      const nextPaymentStatus = isFullRefund
        ? PrismaPaymentStatus.REFUNDED
        : PrismaPaymentStatus.PARTIALLY_REFUNDED
      const nextOrderStatus =
        isFullRefund && lockedOrder.order_status !== PrismaOrderStatus.CANCELLED
          ? PrismaOrderStatus.REFUNDED
          : lockedOrder.order_status

      const isUnexpectedUnshippedDashboardRefund =
        !originatedInternally && UNSHIPPED_ALERT_ORDER_STATUSES.has(lockedOrder.order_status)

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: nextPaymentStatus },
      })

      await tx.order.update({
        where: { id: lockedOrder.id },
        data: {
          refunded_paise: nextRefundedPaise,
          payment_status: nextPaymentStatus,
          order_status: nextOrderStatus,
          ...(isUnexpectedUnshippedDashboardRefund ? { needs_attention: true } : {}),
        },
      })

      await tx.orderEvent.create({
        data: {
          order_id: lockedOrder.id,
          status: nextOrderStatus,
          note: isUnexpectedUnshippedDashboardRefund
            ? `Unexpected dashboard refund processed (${gatewayRefundId}: ${amountPaise} paise) on unshipped order — flagged for review; stock untouched`
            : `Refund processed (${gatewayRefundId}: ${amountPaise} paise, cumulative ${nextRefundedPaise}/${lockedOrder.total_paise} paise); stock untouched`,
          actor: 'webhook:refund.processed',
        },
      })

      return {
        kind: 'UPDATED' as const,
        orderId: lockedOrder.id,
        orderNumber: lockedOrder.order_number,
        previousOrderStatus: lockedOrder.order_status,
        nextRefundedPaise,
        totalPaise: lockedOrder.total_paise,
        isFullRefund,
        isUnexpectedUnshippedDashboardRefund,
      }
    })

    if (txOutcome.kind === 'UNKNOWN') {
      await this.prisma.webhookEvent.update({
        where: { event_id: eventId },
        data: { status: 'IGNORED', processed_at: new Date() },
      })
      return webhookAckResponseSchema.parse({
        received: true,
        duplicate: false,
        eventId,
        outcome: 'IGNORED',
      })
    }

    await this.prisma.webhookEvent.update({
      where: { event_id: eventId },
      data: {
        order_id: txOutcome.orderId,
        status: txOutcome.kind === 'ALREADY_HANDLED' ? 'DUPLICATE' : 'PROCESSED',
        processed_at: new Date(),
      },
    })

    if (txOutcome.kind === 'UPDATED') {
      void this.queueService.enqueueCustomerNotification({
        event: txOutcome.isFullRefund
          ? 'ORDER_REFUNDED'
          : `ORDER_PARTIALLY_REFUNDED_${txOutcome.nextRefundedPaise}`,
        orderId: txOutcome.orderId,
        orderNumber: txOutcome.orderNumber,
        message: txOutcome.isFullRefund
          ? `Full refund processed for order ${txOutcome.orderNumber}`
          : `Partial refund (${amountPaise} paise) processed for order ${txOutcome.orderNumber}`,
      })

      if (txOutcome.isUnexpectedUnshippedDashboardRefund) {
        await this.opsAlertService.alertCritical({
          alertKey: 'unexpected-dashboard-refund',
          severity: 'CRITICAL',
          orderId: txOutcome.orderId,
          message: `Unexpected dashboard refund (${gatewayRefundId}, ${amountPaise} paise) on unshipped order ${txOutcome.orderNumber} (was ${txOutcome.previousOrderStatus}). Verify parcel wasn't dispatched! Stock was NOT restored automatically.`,
          details: {
            gatewayRefundId,
            gatewayPaymentId,
            amountPaise,
            previousOrderStatus: txOutcome.previousOrderStatus,
          },
        })
      }
    }

    return webhookAckResponseSchema.parse({
      received: true,
      duplicate: txOutcome.kind === 'ALREADY_HANDLED',
      eventId,
      outcome: txOutcome.kind === 'ALREADY_HANDLED' ? 'DUPLICATE' : 'PROCESSED',
    })
  }

  private async processRefundFailed(
    eventId: string,
    payload: RazorpayWebhookPayload,
  ): Promise<WebhookAckResponseDto> {
    const refundEntity = payload.payload?.refund?.entity
    const paymentEntity = payload.payload?.payment?.entity
    const gatewayRefundId = refundEntity?.id
    const gatewayPaymentId = refundEntity?.payment_id ?? paymentEntity?.id
    const amountPaise = typeof refundEntity?.amount === 'number' ? refundEntity.amount : 0

    const payment = gatewayPaymentId
      ? await this.prisma.payment.findUnique({
          where: { gateway_payment_id: gatewayPaymentId },
          select: { id: true, order_id: true },
        })
      : null

    if (!payment || !gatewayRefundId) {
      await this.prisma.webhookEvent.update({
        where: { event_id: eventId },
        data: {
          status: 'IGNORED',
          error_message: 'Unknown payment reference for refund.failed',
          processed_at: new Date(),
        },
      })
      return webhookAckResponseSchema.parse({
        received: true,
        duplicate: false,
        eventId,
        outcome: 'IGNORED',
      })
    }

    const orderSummary = await this.prisma.$transaction(async (tx) => {
      const lockedOrders = await tx.$queryRaw<
        Array<{ id: string; order_number: string; order_status: PrismaOrderStatus }>
      >`SELECT id, order_number, order_status FROM orders WHERE id = ${payment.order_id} FOR UPDATE`
      const lockedOrder = lockedOrders[0]
      if (!lockedOrder) return null

      const existingRefund = await tx.refund.findUnique({
        where: { gateway_refund_id: gatewayRefundId },
      })
      if (existingRefund) {
        await tx.refund.update({
          where: { id: existingRefund.id },
          data: {
            status: 'FAILED',
            raw_payload: payload as unknown as Prisma.InputJsonValue,
          },
        })
      } else {
        await tx.refund.create({
          data: {
            order_id: lockedOrder.id,
            payment_id: payment.id,
            gateway_refund_id: gatewayRefundId,
            amount_paise: Math.max(0, amountPaise),
            status: 'FAILED',
            reason: 'Gateway refund.failed webhook',
            initiated_by: 'webhook:refund.failed',
            raw_payload: payload as unknown as Prisma.InputJsonValue,
          },
        })
      }

      await tx.order.update({
        where: { id: lockedOrder.id },
        data: { needs_attention: true },
      })

      await tx.orderEvent.create({
        data: {
          order_id: lockedOrder.id,
          status: lockedOrder.order_status,
          note: `Gateway refund FAILED (${gatewayRefundId}: ${amountPaise} paise). Manual intervention required.`,
          actor: 'webhook:refund.failed',
        },
      })

      return lockedOrder
    })

    await this.prisma.webhookEvent.update({
      where: { event_id: eventId },
      data: {
        order_id: orderSummary?.id ?? null,
        status: 'PROCESSED',
        processed_at: new Date(),
      },
    })

    if (orderSummary) {
      await this.opsAlertService.alertCritical({
        alertKey: 'gateway-refund-failed',
        severity: 'CRITICAL',
        orderId: orderSummary.id,
        message: `Gateway refund FAILED (${gatewayRefundId}) on order ${orderSummary.order_number}. Manual refund retry needed.`,
        details: { gatewayRefundId, gatewayPaymentId, amountPaise },
      })
    }

    return webhookAckResponseSchema.parse({
      received: true,
      duplicate: false,
      eventId,
      outcome: 'RECORDED',
    })
  }
}
