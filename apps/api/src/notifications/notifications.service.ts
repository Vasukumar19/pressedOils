import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  ALERT_SEVERITY,
  formatDateIndia,
  formatPaiseToInr,
  isProductionRuntime,
  NOTIFICATION_CHANNEL,
} from '@pressedoils/shared'
import { env } from '../env'
import { PrismaService } from '../prisma/prisma.service'
import { OpsAlertService } from '../queue/ops-alert.service'
import {
  type CustomerNotificationJobPayload,
  type OpsAlertJobPayload,
  QueueService,
} from '../queue/queue.service'
import { SettingsService } from '../settings/settings.service'
import {
  EMAIL_TRANSPORT,
  type EmailTransport,
  hashEmailForSuppression,
  maskEmail,
  maskPhone,
  SMS_TRANSPORT,
  type SmsTransport,
} from './notification.types'
import {
  buildCustomerNotificationTemplate,
  buildOtpSmsTemplate,
  buildOwnerAlertTemplate,
} from './templates/notification-templates'
import { ResendEmailTransport } from './transports/resend-email.transport'

const DEV_FALLBACK_HASH_SECRET = 'dev-only-notification-hash-secret-not-for-prod'
const MOCK_RESEND_WEBHOOK_SECRET = 'whsec_bW9ja19yZXNlbmRfd2ViaG9va19kZXZfc2VjcmV0'
const MOCK_MSG91_WEBHOOK_SECRET = 'mock_msg91_webhook_dev_only_secret'
const FAILED_JOB_QUEUE_THRESHOLD = 10

interface ResendWebhookPayload {
  type?: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    bounce?: { type?: string; message?: string }
  }
}

interface Msg91WebhookPayload {
  request_id?: string
  requestId?: string
  event_id?: string
  status?: string
  report?: Array<{ status?: string; desc?: string }>
  desc?: string
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly opsAlertService: OpsAlertService,
    private readonly queueService: QueueService,
    @Inject(EMAIL_TRANSPORT) private readonly emailTransport: EmailTransport,
    @Inject(SMS_TRANSPORT) private readonly smsTransport: SmsTransport,
  ) {}

  private isProdRuntime(): boolean {
    return isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })
  }

  private getHashSecret(): string {
    return env.OTP_HMAC_SECRET ?? env.PICKUP_CODE_HMAC_SECRET ?? DEV_FALLBACK_HASH_SECRET
  }

  /**
   * Sends customer SMS + Email for any order lifecycle transition using deterministic
   * per-(order, event, channel) idempotency keys in `notifications`.
   * Retries never duplicate already-sent channels, and suppressed emails are skipped safely.
   */
  async deliverCustomerNotification(payload: CustomerNotificationJobPayload): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: {
        customer: { select: { name: true, phone: true, email: true, deleted_at: true } },
        pickup_location: { select: { name: true, address: true, hours: true } },
      },
    })

    if (!order || order.customer.deleted_at) {
      this.logger.warn({
        event: 'NOTIFICATION_ORDER_OR_CUSTOMER_UNAVAILABLE',
        orderId: payload.orderId,
        notificationEvent: payload.event,
      })
      return
    }

    const settings = await this.settingsService.getInternalPricingSettings()
    const rendered = buildCustomerNotificationTemplate({
      event: payload.event,
      brandName: settings.brandName,
      supportEmail: settings.supportEmail,
      supportPhone: settings.supportPhone,
      orderNumber: order.order_number,
      totalFormatted: formatPaiseToInr(order.total_paise),
      trackingUrl: payload.trackingUrl ?? order.tracking_url,
      pickupLocationName: order.pickup_location?.name ?? null,
      pickupAddress: order.pickup_location?.address ?? null,
      pickupHours: order.pickup_location?.hours ?? null,
      pickupCode: payload.pickupCode ?? null,
      lastCollectionDate: order.pickup_last_collection_at
        ? formatDateIndia(order.pickup_last_collection_at)
        : null,
      amountFormatted:
        typeof payload.amountPaise === 'number' ? formatPaiseToInr(payload.amountPaise) : null,
      cumulativeRefundedFormatted:
        typeof payload.cumulativeRefundedPaise === 'number'
          ? formatPaiseToInr(payload.cumulativeRefundedPaise)
          : null,
    })

    const dedupeScope =
      payload.pickupCode && payload.event === 'PICKUP_CODE_REISSUED'
        ? `${payload.event}:${order.pickup_code_reissue_count}`
        : payload.event === 'ORDER_PARTIALLY_REFUNDED' &&
            typeof payload.cumulativeRefundedPaise === 'number'
          ? `${payload.event}:${payload.cumulativeRefundedPaise}`
          : payload.event

    const safePayloadSummary = {
      orderNumber: order.order_number,
      event: payload.event,
      templateVersion: rendered.templateVersion,
    }

    const errors: string[] = []

    if (order.customer.phone) {
      const smsIdempKey = `notify:SMS:${order.id}:${dedupeScope}`
      const maskedTo = maskPhone(order.customer.phone)
      try {
        await this.deliverSingleChannel({
          idempotencyKey: smsIdempKey,
          orderId: order.id,
          channel: NOTIFICATION_CHANNEL.SMS,
          event: payload.event,
          templateId: rendered.templateId,
          templateVersion: rendered.templateVersion,
          providerName: this.smsTransport.providerName,
          maskedRecipient: maskedTo,
          payloadSummary: safePayloadSummary,
          executeSend: () =>
            this.smsTransport.send({
              toPhone: order.customer.phone,
              dltTemplateKey: rendered.dltTemplateKey,
              textBody: rendered.smsBody,
              variables: rendered.smsVariables,
            }),
        })
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'SMS dispatch error')
      }
    }

    if (order.customer.email) {
      const emailIdempKey = `notify:EMAIL:${order.id}:${dedupeScope}`
      const maskedTo = maskEmail(order.customer.email)
      const emailHash = hashEmailForSuppression(order.customer.email, this.getHashSecret())
      const suppressed = await this.prisma.emailSuppression.findUnique({
        where: { email_hash: emailHash },
        select: { reason: true },
      })

      if (suppressed) {
        await this.recordSuppressedEmail({
          idempotencyKey: emailIdempKey,
          orderId: order.id,
          event: payload.event,
          templateId: rendered.templateId,
          templateVersion: rendered.templateVersion,
          maskedRecipient: maskedTo,
          reason: suppressed.reason,
          payloadSummary: safePayloadSummary,
        })
      } else {
        const emailAddr = order.customer.email
        try {
          await this.deliverSingleChannel({
            idempotencyKey: emailIdempKey,
            orderId: order.id,
            channel: NOTIFICATION_CHANNEL.EMAIL,
            event: payload.event,
            templateId: rendered.templateId,
            templateVersion: rendered.templateVersion,
            providerName: this.emailTransport.providerName,
            maskedRecipient: maskedTo,
            payloadSummary: safePayloadSummary,
            executeSend: () =>
              this.emailTransport.send({
                to: emailAddr,
                subject: rendered.emailSubject,
                html: rendered.emailHtml,
                text: rendered.emailText,
                tags: [
                  { name: 'event', value: payload.event },
                  { name: 'order_number', value: order.order_number },
                ],
              }),
          })
        } catch (err) {
          errors.push(err instanceof Error ? err.message : 'Email dispatch error')
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Notification delivery incomplete: ${errors.join('; ')}`)
    }
  }

  /**
   * Sends OTP SMS directly (synchronous during OTP issuance so user immediately sees failure/retry).
   * Logs ONLY masked phone number & never persists or logs plaintext OTP code.
   */
  async sendOtpSms(input: {
    challengeId: string
    phone: string
    code: string
    ttlMinutes: number
    purposeLabel: string
  }): Promise<void> {
    const settings = await this.settingsService.getInternalPricingSettings()
    const rendered = buildOtpSmsTemplate({
      brandName: settings.brandName,
      code: input.code,
      ttlMinutes: input.ttlMinutes,
      purposeLabel: input.purposeLabel,
    })

    const maskedTo = maskPhone(input.phone)
    await this.deliverSingleChannel({
      idempotencyKey: `otp:SMS:${input.challengeId}`,
      orderId: null,
      channel: NOTIFICATION_CHANNEL.SMS,
      event: `OTP_${input.purposeLabel.toUpperCase().replace(/\s+/g, '_')}`,
      templateId: rendered.templateId,
      templateVersion: rendered.templateVersion,
      providerName: this.smsTransport.providerName,
      maskedRecipient: maskedTo,
      payloadSummary: { challengeId: input.challengeId, templateVersion: rendered.templateVersion },
      executeSend: () =>
        this.smsTransport.send({
          toPhone: input.phone,
          dltTemplateKey: 'OTP',
          textBody: rendered.smsBody,
          variables: rendered.variables,
        }),
    })
  }

  /**
   * Delivers owner operational alerts queued via BullMQ (`ops-alerts`):
   *  - WARNING -> email only (OWNER_ALERT_EMAIL)
   *  - CRITICAL -> email (OWNER_ALERT_EMAIL) AND SMS (OWNER_ALERT_PHONE)
   */
  async dispatchOwnerAlertDelivery(payload: OpsAlertJobPayload): Promise<void> {
    if (payload.severity === ALERT_SEVERITY.INFO) return

    const settings = await this.settingsService.getInternalPricingSettings()
    const rendered = buildOwnerAlertTemplate({
      brandName: settings.brandName,
      alertKey: payload.alertKey,
      severity: payload.severity,
      orderNumber: payload.orderNumber ?? null,
      reason: payload.message,
      occurrenceCount: payload.occurrenceCount,
      supportEmail: settings.supportEmail,
      supportPhone: settings.supportPhone,
    })

    const emailErrors: string[] = []
    for (let i = 0; i < env.OWNER_ALERT_EMAIL.length; i += 1) {
      const email = env.OWNER_ALERT_EMAIL[i]!
      const idemp = `alert:EMAIL:${payload.alertDispatchId}:${i}`
      try {
        await this.deliverSingleChannel({
          idempotencyKey: idemp,
          orderId: payload.orderId ?? null,
          channel: NOTIFICATION_CHANNEL.EMAIL,
          event: `ALERT_${payload.alertKey}`,
          templateId: rendered.templateId,
          templateVersion: rendered.templateVersion,
          providerName: this.emailTransport.providerName,
          maskedRecipient: maskEmail(email),
          payloadSummary: {
            alertKey: payload.alertKey,
            severity: payload.severity,
            orderNumber: payload.orderNumber ?? null,
            occurrenceCount: payload.occurrenceCount,
          },
          executeSend: () =>
            this.emailTransport.send({
              to: email,
              subject: rendered.emailSubject,
              html: rendered.emailHtml,
              text: rendered.emailText,
              tags: [{ name: 'alert_key', value: payload.alertKey }],
            }),
        })
      } catch (err) {
        emailErrors.push(err instanceof Error ? err.message : 'alert email failed')
      }
    }

    if (payload.severity === ALERT_SEVERITY.CRITICAL) {
      for (let i = 0; i < env.OWNER_ALERT_PHONE.length; i += 1) {
        const phone = env.OWNER_ALERT_PHONE[i]!
        const idemp = `alert:SMS:${payload.alertDispatchId}:${i}`
        try {
          await this.deliverSingleChannel({
            idempotencyKey: idemp,
            orderId: payload.orderId ?? null,
            channel: NOTIFICATION_CHANNEL.SMS,
            event: `ALERT_${payload.alertKey}`,
            templateId: rendered.templateId,
            templateVersion: rendered.templateVersion,
            providerName: this.smsTransport.providerName,
            maskedRecipient: maskPhone(phone),
            payloadSummary: {
              alertKey: payload.alertKey,
              severity: payload.severity,
              orderNumber: payload.orderNumber ?? null,
            },
            executeSend: () =>
              this.smsTransport.send({
                toPhone: phone,
                dltTemplateKey: rendered.dltTemplateKey,
                textBody: rendered.smsBody,
                variables: rendered.smsVariables,
              }),
          })
        } catch (err) {
          emailErrors.push(err instanceof Error ? err.message : 'alert SMS failed')
        }
      }
    }

    if (
      emailErrors.length > 0 &&
      (env.OWNER_ALERT_EMAIL.length > 0 || env.OWNER_ALERT_PHONE.length > 0)
    ) {
      this.logger.warn({
        event: 'OWNER_ALERT_DELIVERY_PARTIAL_ERROR',
        alertKey: payload.alertKey,
        error: emailErrors.join('; '),
      })
    }
  }

  /**
   * Handles Resend email delivery/bounce/complaint webhooks with Svix HMAC signature verification,
   * event deduplication in `webhook_events`, and suppression-list insertion on bounces/complaints.
   */
  async handleResendWebhook(input: {
    rawBody: Buffer | undefined
    svixId: string | undefined
    svixTimestamp: string | undefined
    svixSignature: string | undefined
  }): Promise<{ received: true; duplicate: boolean; eventId: string; status: string }> {
    if (!input.rawBody || !Buffer.isBuffer(input.rawBody) || input.rawBody.length === 0) {
      throw new BadRequestException('Raw webhook body is required')
    }

    const secret = this.isProdRuntime()
      ? env.RESEND_WEBHOOK_SECRET
      : (env.RESEND_WEBHOOK_SECRET ??
        (this.emailTransport.providerName === 'mock' ? MOCK_RESEND_WEBHOOK_SECRET : undefined))

    if (
      !secret ||
      !ResendEmailTransport.verifySvixSignature({
        rawBody: input.rawBody,
        svixId: input.svixId,
        svixTimestamp: input.svixTimestamp,
        svixSignature: input.svixSignature,
        secret,
      })
    ) {
      throw new UnauthorizedException('Invalid Resend webhook signature')
    }

    let payload: ResendWebhookPayload
    try {
      payload = JSON.parse(input.rawBody.toString('utf8')) as ResendWebhookPayload
    } catch {
      throw new BadRequestException('Invalid webhook JSON payload')
    }

    const payloadHash = createHash('sha256').update(input.rawBody).digest('hex')
    const eventId = input.svixId?.trim() || `resend_sha256_${payloadHash.slice(0, 28)}`
    const eventType = payload.type ?? 'unknown'

    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: 'resend',
          event_id: eventId,
          event_type: eventType,
          payload_hash: payloadHash,
          status: 'RECEIVED',
          raw_payload: payload as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { received: true, duplicate: true, eventId, status: 'DUPLICATE' }
      }
      throw err
    }

    const providerMsgId = payload.data?.email_id
    if (eventType === 'email.delivered' && providerMsgId) {
      await this.prisma.notificationLog.updateMany({
        where: { provider_message_id: providerMsgId },
        data: { status: 'DELIVERED', delivered_at: new Date() },
      })
      await this.prisma.webhookEvent.update({
        where: { event_id: eventId },
        data: { status: 'PROCESSED', processed_at: new Date() },
      })
      return { received: true, duplicate: false, eventId, status: 'DELIVERED' }
    }

    if (eventType === 'email.bounced' || eventType === 'email.complained') {
      const nextStatus = eventType === 'email.complained' ? 'COMPLAINED' : 'BOUNCED'
      const reason = eventType === 'email.complained' ? 'COMPLAINT' : 'BOUNCE'
      const rawRecipients = Array.isArray(payload.data?.to)
        ? payload.data.to
        : typeof payload.data?.to === 'string'
          ? [payload.data.to]
          : []

      for (const email of rawRecipients) {
        const cleanEmail = email.trim().toLowerCase()
        if (!cleanEmail) continue
        const emailHash = hashEmailForSuppression(cleanEmail, this.getHashSecret())
        await this.prisma.emailSuppression.upsert({
          where: { email_hash: emailHash },
          update: { reason, source_event_id: eventId },
          create: {
            email_hash: emailHash,
            masked_email: maskEmail(cleanEmail),
            reason,
            source_provider: 'resend',
            source_event_id: eventId,
          },
        })
      }

      if (providerMsgId) {
        await this.prisma.notificationLog.updateMany({
          where: { provider_message_id: providerMsgId },
          data: {
            status: nextStatus,
            error_message: payload.data?.bounce?.message ?? reason,
          },
        })
      }

      await this.prisma.webhookEvent.update({
        where: { event_id: eventId },
        data: { status: 'PROCESSED', processed_at: new Date() },
      })

      await this.opsAlertService.alertCritical({
        alertKey: `email-${reason.toLowerCase()}`,
        severity: ALERT_SEVERITY.WARNING,
        message: `Email ${reason.toLowerCase()} reported via Resend webhook (${rawRecipients.length} address(es) added to suppression list)`,
        details: { eventId, reason },
      })

      return { received: true, duplicate: false, eventId, status: nextStatus }
    }

    await this.prisma.webhookEvent.update({
      where: { event_id: eventId },
      data: { status: 'IGNORED', processed_at: new Date() },
    })
    return { received: true, duplicate: false, eventId, status: 'IGNORED' }
  }

  /**
   * Handles MSG91 delivery report webhooks cleanly with constant-time secret validation.
   */
  async handleMsg91Webhook(input: {
    rawBody: Buffer | undefined
    webhookSecretHeader: string | undefined
    eventIdHeader: string | undefined
  }): Promise<{ received: true; duplicate: boolean; eventId: string; status: string }> {
    if (!input.rawBody || !Buffer.isBuffer(input.rawBody) || input.rawBody.length === 0) {
      throw new BadRequestException('Raw webhook body is required')
    }

    const expectedSecret = this.isProdRuntime()
      ? env.MSG91_WEBHOOK_SECRET
      : (env.MSG91_WEBHOOK_SECRET ??
        (this.smsTransport.providerName === 'mock' ? MOCK_MSG91_WEBHOOK_SECRET : undefined))

    if (!expectedSecret || !input.webhookSecretHeader) {
      throw new UnauthorizedException('Invalid MSG91 webhook credentials')
    }
    const a = Buffer.from(expectedSecret, 'utf8')
    const b = Buffer.from(input.webhookSecretHeader.trim(), 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid MSG91 webhook credentials')
    }

    let payload: Msg91WebhookPayload
    try {
      payload = JSON.parse(input.rawBody.toString('utf8')) as Msg91WebhookPayload
    } catch {
      throw new BadRequestException('Invalid webhook JSON payload')
    }

    const payloadHash = createHash('sha256').update(input.rawBody).digest('hex')
    const eventId =
      input.eventIdHeader?.trim() ||
      payload.event_id?.trim() ||
      `msg91_sha256_${payloadHash.slice(0, 28)}`
    const rawStatus = (payload.status ?? payload.report?.[0]?.status ?? 'unknown').toUpperCase()

    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: 'msg91',
          event_id: eventId,
          event_type: `sms.${rawStatus.toLowerCase()}`,
          payload_hash: payloadHash,
          status: 'RECEIVED',
          raw_payload: payload as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { received: true, duplicate: true, eventId, status: 'DUPLICATE' }
      }
      throw err
    }

    const reqId = payload.request_id ?? payload.requestId
    const isDelivered = rawStatus.includes('DELIVER') || rawStatus === '1'
    const isFailed = rawStatus.includes('FAIL') || rawStatus.includes('REJECT') || rawStatus === '2'

    if (reqId && (isDelivered || isFailed)) {
      await this.prisma.notificationLog.updateMany({
        where: { provider_message_id: reqId },
        data: isDelivered
          ? { status: 'DELIVERED', delivered_at: new Date() }
          : {
              status: 'FAILED',
              error_message: payload.desc ?? payload.report?.[0]?.desc ?? rawStatus,
            },
      })
    }

    await this.prisma.webhookEvent.update({
      where: { event_id: eventId },
      data: { status: 'PROCESSED', processed_at: new Date() },
    })

    return {
      received: true,
      duplicate: false,
      eventId,
      status: isDelivered ? 'DELIVERED' : isFailed ? 'FAILED' : 'RECORDED',
    }
  }

  /**
   * Periodic health, SMS balance, and BullMQ failed-job queue monitor executed every 30m by worker.
   */
  async runProviderHealthAndBalanceCheck(): Promise<{
    emailHealthy: boolean
    smsHealthy: boolean
    smsBalance: number | null
    failedQueueCount: number
  }> {
    const [emailHealth, smsHealth, failedQueueCount] = await Promise.all([
      this.emailTransport.checkHealth(),
      this.smsTransport.checkHealth(),
      this.queueService.getFailedJobsCount(),
    ])

    if (!emailHealth.ok) {
      await this.opsAlertService.alertCritical({
        alertKey: 'email-provider-unhealthy',
        severity: ALERT_SEVERITY.CRITICAL,
        message: `Email provider "${emailHealth.provider}" health check failed: ${emailHealth.details ?? 'unreachable'}`,
      })
    }

    if (!smsHealth.ok) {
      await this.opsAlertService.alertCritical({
        alertKey: 'sms-provider-unhealthy',
        severity: ALERT_SEVERITY.CRITICAL,
        message: `SMS provider "${smsHealth.provider}" health check failed: ${smsHealth.details ?? 'unreachable'}`,
      })
    } else if (
      typeof smsHealth.remainingCredits === 'number' &&
      smsHealth.remainingCredits < env.SMS_LOW_BALANCE_THRESHOLD
    ) {
      await this.opsAlertService.alertCritical({
        alertKey: 'sms-low-balance',
        severity: ALERT_SEVERITY.CRITICAL,
        message: `SMS provider credits low: ${smsHealth.remainingCredits} remaining (threshold ${env.SMS_LOW_BALANCE_THRESHOLD})`,
        details: {
          provider: smsHealth.provider,
          remainingCredits: smsHealth.remainingCredits,
          threshold: env.SMS_LOW_BALANCE_THRESHOLD,
        },
      })
    }

    if (failedQueueCount >= FAILED_JOB_QUEUE_THRESHOLD) {
      await this.opsAlertService.alertCritical({
        alertKey: 'failed-job-queue-growing',
        severity: ALERT_SEVERITY.CRITICAL,
        message: `BullMQ failed-job queue growing: ${failedQueueCount} failed jobs require investigation`,
        details: { failedQueueCount },
      })
    }

    return {
      emailHealthy: emailHealth.ok,
      smsHealthy: smsHealth.ok,
      smsBalance: smsHealth.remainingCredits ?? null,
      failedQueueCount,
    }
  }

  static getMockResendWebhookSecretForTests(): string {
    return MOCK_RESEND_WEBHOOK_SECRET
  }

  static getMockMsg91WebhookSecretForTests(): string {
    return MOCK_MSG91_WEBHOOK_SECRET
  }

  static computeTestSvixHeaders(rawBody: string, secret: string, svixId = `msg_${randomUUID()}`) {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const secretRaw = secret.startsWith('whsec_') ? secret.slice(6) : secret
    const keyBytes = Buffer.from(secretRaw, 'base64')
    const signed = `${svixId}.${timestamp}.${rawBody}`
    const sig = createHmac('sha256', keyBytes).update(signed).digest('base64')
    return {
      svixId,
      svixTimestamp: timestamp,
      svixSignature: `v1,${sig}`,
    }
  }

  private async deliverSingleChannel(input: {
    idempotencyKey: string
    orderId: string | null
    channel: string
    event: string
    templateId: string
    templateVersion: string
    providerName: string
    maskedRecipient: string
    payloadSummary: Record<string, unknown>
    executeSend: () => Promise<{
      ok: boolean
      provider: string
      providerMessageId: string | null
      error?: string
    }>
  }): Promise<void> {
    const existing = await this.prisma.notificationLog.findUnique({
      where: { idempotency_key: input.idempotencyKey },
      select: { id: true, status: true },
    })

    if (
      existing &&
      (existing.status === 'SENT' ||
        existing.status === 'DELIVERED' ||
        existing.status === 'SUPPRESSED')
    ) {
      return
    }

    let rowId = existing?.id
    if (!rowId) {
      try {
        const created = await this.prisma.notificationLog.create({
          data: {
            idempotency_key: input.idempotencyKey,
            order_id: input.orderId,
            channel: input.channel,
            event: input.event,
            template_id: input.templateId,
            template_version: input.templateVersion,
            provider: input.providerName,
            masked_recipient: input.maskedRecipient,
            status: 'QUEUED',
            payload_summary: input.payloadSummary as Prisma.InputJsonValue,
          },
          select: { id: true },
        })
        rowId = created.id
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const raceRow = await this.prisma.notificationLog.findUnique({
            where: { idempotency_key: input.idempotencyKey },
            select: { id: true, status: true },
          })
          if (raceRow && raceRow.status !== 'FAILED') {
            return
          }
          rowId = raceRow?.id
        } else {
          throw err
        }
      }
    }

    const result = await input.executeSend()
    if (result.ok) {
      if (rowId) {
        await this.prisma.notificationLog.update({
          where: { id: rowId },
          data: {
            status: 'SENT',
            provider_message_id: result.providerMessageId,
            error_message: null,
            sent_at: new Date(),
          },
        })
      }
      this.logger.log({
        event: 'NOTIFICATION_DISPATCHED',
        channel: input.channel,
        notificationEvent: input.event,
        maskedRecipient: input.maskedRecipient,
        provider: result.provider,
        orderId: input.orderId,
      })
      return
    }

    if (rowId) {
      await this.prisma.notificationLog.update({
        where: { id: rowId },
        data: {
          status: 'FAILED',
          error_message: result.error?.slice(0, 400) ?? 'Unknown provider failure',
        },
      })
    }

    this.logger.warn({
      event: 'NOTIFICATION_DELIVERY_FAILED',
      channel: input.channel,
      notificationEvent: input.event,
      maskedRecipient: input.maskedRecipient,
      provider: result.provider,
      error: result.error,
    })

    throw new Error(result.error ?? `${input.channel} transport delivery failed`)
  }

  private async recordSuppressedEmail(input: {
    idempotencyKey: string
    orderId: string | null
    event: string
    templateId: string
    templateVersion: string
    maskedRecipient: string
    reason: string
    payloadSummary: Record<string, unknown>
  }): Promise<void> {
    await this.prisma.notificationLog.upsert({
      where: { idempotency_key: input.idempotencyKey },
      update: {},
      create: {
        idempotency_key: input.idempotencyKey,
        order_id: input.orderId,
        channel: NOTIFICATION_CHANNEL.EMAIL,
        event: input.event,
        template_id: input.templateId,
        template_version: input.templateVersion,
        provider: this.emailTransport.providerName,
        masked_recipient: input.maskedRecipient,
        status: 'SUPPRESSED',
        error_message: `Suppressed due to prior ${input.reason}`,
        payload_summary: input.payloadSummary as Prisma.InputJsonValue,
      },
    })
  }
}
