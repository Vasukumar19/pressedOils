import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ALERT_GROUP_WINDOW_SECONDS, ALERT_SEVERITY, type AlertSeverity } from '@pressedoils/shared'
import { env } from '../env'
import { RedisService } from '../redis/redis.service'
import { QueueService } from './queue.service'

export interface OpsAlertInput {
  alertKey: string
  severity?: AlertSeverity
  orderId?: string
  orderNumber?: string
  message: string
  details?: Record<string, unknown>
  bypassThrottle?: boolean
}

export interface OpsAlertOutcome {
  dispatched: boolean
  throttled: boolean
  occurrenceCount: number
  severity: AlertSeverity
}

const SPIKE_WINDOW_SECONDS = 300
const INVALID_SIGNATURE_SPIKE_THRESHOLD = 10
const FAILED_PAYMENT_SPIKE_THRESHOLD = 10

/**
 * Alerts human operators on critical/warning anomalies with strict 15-minute grouping & throttling:
 *  - INFO: logs only
 *  - WARNING: logs + Sentry + Email (OWNER_ALERT_EMAIL)
 *  - CRITICAL: logs + Sentry + external Uptime webhook + Email + SMS (OWNER_ALERT_PHONE)
 * Never carries customer PII (strictly orderNumber + operational reason + repetition count).
 */
@Injectable()
export class OpsAlertService {
  private readonly logger = new Logger(OpsAlertService.name)

  constructor(
    private readonly queueService: QueueService,
    private readonly redis: RedisService,
  ) {}

  async alertCritical(input: OpsAlertInput): Promise<OpsAlertOutcome> {
    const severity: AlertSeverity = input.severity ?? ALERT_SEVERITY.CRITICAL

    if (severity === ALERT_SEVERITY.INFO) {
      this.logger.log({
        alert: input.alertKey,
        severity,
        orderNumber: input.orderNumber ?? null,
        message: input.message,
      })
      return { dispatched: false, throttled: false, occurrenceCount: 1, severity }
    }

    let throttled = false
    let occurrenceCount = 1

    if (!input.bypassThrottle) {
      const gateKey = `ops:alert:gate:${input.alertKey}`
      const suppressedKey = `ops:alert:suppressed:${input.alertKey}`
      const acquired = await this.redis.setStringNx(gateKey, '1', ALERT_GROUP_WINDOW_SECONDS)
      if (acquired === false) {
        throttled = true
        await this.redis.incrKey(suppressedKey, ALERT_GROUP_WINDOW_SECONDS * 2)
      } else if (acquired === true) {
        const priorRaw = await this.redis.getString(suppressedKey)
        const priorCount = priorRaw ? Math.max(0, Number(priorRaw) || 0) : 0
        await this.redis.del(suppressedKey)
        occurrenceCount = 1 + priorCount
      }
    }

    if (throttled) {
      this.logger.warn({
        event: 'OPS_ALERT_THROTTLED',
        alert: input.alertKey,
        severity,
        orderNumber: input.orderNumber ?? null,
        windowSeconds: ALERT_GROUP_WINDOW_SECONDS,
      })
      return { dispatched: false, throttled: true, occurrenceCount: 0, severity }
    }

    const logPayload = {
      alert: input.alertKey,
      severity,
      orderId: input.orderId ?? null,
      orderNumber: input.orderNumber ?? null,
      occurrenceCount,
      message: input.message,
      details: input.details ?? {},
    }

    if (severity === ALERT_SEVERITY.CRITICAL) {
      this.logger.error(logPayload)
    } else {
      this.logger.warn(logPayload)
    }

    const dispatches: Array<Promise<unknown>> = [
      this.queueService.enqueueOpsAlert({
        alertDispatchId: randomUUID(),
        alertKey: input.alertKey,
        severity,
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.orderNumber ? { orderNumber: input.orderNumber } : {}),
        message: input.message,
        occurrenceCount,
      }),
      this.dispatchSentryEvent(input, severity, occurrenceCount),
    ]

    if (severity === ALERT_SEVERITY.CRITICAL) {
      dispatches.push(this.dispatchExternalUptimeWebhook(input, severity, occurrenceCount))
    }

    await Promise.allSettled(dispatches)
    return { dispatched: true, throttled: false, occurrenceCount, severity }
  }

  async recordInvalidWebhookSignature(): Promise<void> {
    const hit = await this.redis.incrKey('ops:spike:webhook_bad_sig', SPIKE_WINDOW_SECONDS)
    if (hit !== null && hit >= INVALID_SIGNATURE_SPIKE_THRESHOLD) {
      await this.alertCritical({
        alertKey: 'webhook-invalid-signature-spike',
        severity: ALERT_SEVERITY.CRITICAL,
        message: `Spike of invalid Razorpay webhook signatures detected (${hit} failed checks in 5 min)`,
        details: { count5m: hit },
      })
    }
  }

  async recordPaymentFailedWebhook(): Promise<void> {
    const hit = await this.redis.incrKey('ops:spike:payment_failed', SPIKE_WINDOW_SECONDS)
    if (hit !== null && hit >= FAILED_PAYMENT_SPIKE_THRESHOLD) {
      await this.alertCritical({
        alertKey: 'payment-failed-spike',
        severity: ALERT_SEVERITY.WARNING,
        message: `Elevated payment failures detected (${hit} failed payment webhooks in 5 min)`,
        details: { count5m: hit },
      })
    }
  }

  private async dispatchSentryEvent(
    input: OpsAlertInput,
    severity: AlertSeverity,
    occurrenceCount: number,
  ): Promise<void> {
    if (!env.SENTRY_DSN) return
    try {
      const dsn = new URL(env.SENTRY_DSN)
      const projectId = dsn.pathname.replace(/^\/+/, '')
      const endpoint = `${dsn.protocol}//${dsn.host}/api/${projectId}/store/`
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.username}`,
        },
        body: JSON.stringify({
          level: severity === ALERT_SEVERITY.CRITICAL ? 'fatal' : 'warning',
          message: `[${input.alertKey}] ${input.message}`,
          environment: env.APP_ENV,
          extra: {
            orderNumber: input.orderNumber ?? null,
            occurrenceCount,
            ...input.details,
          },
        }),
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      // Fallback alerting routes never block business flows
    }
  }

  private async dispatchExternalUptimeWebhook(
    input: OpsAlertInput,
    severity: AlertSeverity,
    occurrenceCount: number,
  ): Promise<void> {
    if (!env.UPTIME_ALERT_WEBHOOK_URL) return
    try {
      await fetch(env.UPTIME_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'pressedoils-api',
          environment: env.APP_ENV,
          severity,
          alertKey: input.alertKey,
          orderNumber: input.orderNumber ?? null,
          occurrenceCount,
          message: input.message,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      // Uptime alert failure must not crash request handling
    }
  }
}
