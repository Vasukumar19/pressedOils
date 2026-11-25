import { Injectable, Logger } from '@nestjs/common'
import { env } from '../env'
import { QueueService } from './queue.service'

export interface OpsAlertInput {
  alertKey: string
  severity?: 'HIGH' | 'CRITICAL'
  orderId?: string
  message: string
  details?: Record<string, unknown>
}

/**
 * Alerts human operators on critical payment/stock anomalies:
 *  1) Emits structured error-level alert log (picked up by log monitors)
 *  2) Dispatches error event to Sentry HTTP store if SENTRY_DSN is configured
 *  3) Queues durable owner email/message alert via BullMQ ops-alerts queue
 */
@Injectable()
export class OpsAlertService {
  private readonly logger = new Logger(OpsAlertService.name)

  constructor(private readonly queueService: QueueService) {}

  async alertCritical(input: OpsAlertInput): Promise<void> {
    const severity = input.severity ?? 'CRITICAL'
    this.logger.error({
      alert: input.alertKey,
      severity,
      orderId: input.orderId ?? null,
      ownerEmail: env.OWNER_ALERT_EMAIL ?? null,
      message: input.message,
      details: input.details ?? {},
    })

    await Promise.allSettled([
      this.queueService.enqueueOpsAlert({
        alertKey: input.alertKey,
        severity,
        ownerEmail: env.OWNER_ALERT_EMAIL ?? null,
        ...(input.orderId ? { orderId: input.orderId } : {}),
        message: input.message,
        ...(input.details ? { details: input.details } : {}),
      }),
      this.dispatchSentryEvent(input, severity),
    ])
  }

  private async dispatchSentryEvent(
    input: OpsAlertInput,
    severity: 'HIGH' | 'CRITICAL',
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
          level: severity === 'CRITICAL' ? 'fatal' : 'error',
          message: `[${input.alertKey}] ${input.message}`,
          environment: env.APP_ENV,
          extra: { orderId: input.orderId, ...input.details },
        }),
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      // Never block request handling on telemetry dispatch
    }
  }
}
