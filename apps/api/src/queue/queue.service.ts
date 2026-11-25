import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Queue } from 'bullmq'
import { env } from '../env'
import {
  ALERT_JOB_NAMES,
  DEFAULT_QUEUE_JOB_OPTIONS,
  MAINTENANCE_JOB_NAMES,
  NOTIFICATION_JOB_NAMES,
  QUEUE_NAMES,
  REPEATABLE_SCHEDULER_IDS,
} from './queue.constants'

export interface CustomerNotificationJobPayload {
  event: string
  orderId: string
  orderNumber: string
  message: string
  amountPaise?: number
  cumulativeRefundedPaise?: number
  trackingUrl?: string | null
  pickupCode?: string
}

export interface OpsAlertJobPayload {
  alertDispatchId: string
  alertKey: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  orderId?: string
  orderNumber?: string
  message: string
  occurrenceCount: number
}

export function buildBullMqConnectionOptions(redisUrl: string) {
  const parsed = new URL(redisUrl)
  const dbPath = parsed.pathname.replace('/', '')
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(dbPath && /^\d+$/.test(dbPath) ? { db: Number(dbPath) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null as null,
    enableReadyCheck: true,
  }
}

/**
 * Durable BullMQ queue producers connected exclusively to QUEUE_REDIS_URL
 * (dedicated persistent Redis with maxmemory-policy noeviction).
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name)
  private maintenanceQueue: Queue | null = null
  private notificationsQueue: Queue<CustomerNotificationJobPayload> | null = null
  private opsAlertsQueue: Queue<OpsAlertJobPayload> | null = null

  private isEnabled(): boolean {
    return Boolean(env.QUEUE_REDIS_URL)
  }

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      return
    }
    const connection = buildBullMqConnectionOptions(env.QUEUE_REDIS_URL!)
    this.maintenanceQueue = new Queue(QUEUE_NAMES.ORDERS_MAINTENANCE, {
      connection,
      defaultJobOptions: DEFAULT_QUEUE_JOB_OPTIONS,
    })
    this.notificationsQueue = new Queue<CustomerNotificationJobPayload>(QUEUE_NAMES.NOTIFICATIONS, {
      connection,
      defaultJobOptions: DEFAULT_QUEUE_JOB_OPTIONS,
    })
    this.opsAlertsQueue = new Queue<OpsAlertJobPayload>(QUEUE_NAMES.OPS_ALERTS, {
      connection,
      defaultJobOptions: DEFAULT_QUEUE_JOB_OPTIONS,
    })
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.maintenanceQueue?.close(),
      this.notificationsQueue?.close(),
      this.opsAlertsQueue?.close(),
    ])
    this.maintenanceQueue = null
    this.notificationsQueue = null
    this.opsAlertsQueue = null
  }

  /**
   * Called by the dedicated worker entrypoint (src/worker.ts) so scaling HTTP API replicas
   * does not duplicate scheduler registration.
   */
  async registerRepeatableMaintenanceJobs(): Promise<void> {
    if (!this.maintenanceQueue) {
      await this.onModuleInit()
    }
    if (!this.maintenanceQueue) return

    await Promise.all([
      this.maintenanceQueue.upsertJobScheduler(
        REPEATABLE_SCHEDULER_IDS.RESERVATION_EXPIRY_1M,
        { pattern: '* * * * *' }, // Every 1 minute
        {
          name: MAINTENANCE_JOB_NAMES.RESERVATION_EXPIRY,
          data: {},
          opts: { ...DEFAULT_QUEUE_JOB_OPTIONS, attempts: 3 },
        },
      ),
      this.maintenanceQueue.upsertJobScheduler(
        REPEATABLE_SCHEDULER_IDS.RECONCILE_RECENT_2M,
        { pattern: '*/2 * * * *' }, // Every 2 minutes (orders 2m..60m old)
        {
          name: MAINTENANCE_JOB_NAMES.RECONCILE_RECENT,
          data: { minAgeMinutes: 2, maxAgeMinutes: 60 },
          opts: DEFAULT_QUEUE_JOB_OPTIONS,
        },
      ),
      this.maintenanceQueue.upsertJobScheduler(
        REPEATABLE_SCHEDULER_IDS.RECONCILE_AGING_30M,
        { pattern: '*/30 * * * *' }, // Every 30 minutes (orders 1h..24h old + expire >24h)
        {
          name: MAINTENANCE_JOB_NAMES.RECONCILE_AGING_AND_EXPIRE_24H,
          data: { minAgeMinutes: 60, maxAgeMinutes: 24 * 60 },
          opts: DEFAULT_QUEUE_JOB_OPTIONS,
        },
      ),
      this.maintenanceQueue.upsertJobScheduler(
        REPEATABLE_SCHEDULER_IDS.PROVIDER_HEALTH_30M,
        { pattern: '*/30 * * * *' }, // Every 30 minutes (email/SMS health, balance, queue backlog)
        {
          name: MAINTENANCE_JOB_NAMES.PROVIDER_HEALTH_CHECK,
          data: {},
          opts: { ...DEFAULT_QUEUE_JOB_OPTIONS, attempts: 2 },
        },
      ),
    ])

    this.logger.log('Registered repeatable BullMQ maintenance job schedulers')
  }

  async getFailedJobsCount(): Promise<number> {
    const queues = [this.maintenanceQueue, this.notificationsQueue, this.opsAlertsQueue].filter(
      (q): q is Queue => Boolean(q),
    )
    if (queues.length === 0) return 0
    const counts = await Promise.all(queues.map((q) => q.getFailedCount().catch(() => 0)))
    return counts.reduce((sum, n) => sum + n, 0)
  }

  async enqueueCustomerNotification(payload: CustomerNotificationJobPayload): Promise<void> {
    if (!this.notificationsQueue) return
    try {
      const containsSecretCode = Boolean(payload.pickupCode)
      const uniqueSuffix = payload.pickupCode
        ? `-${Date.now()}`
        : payload.event === 'ORDER_PARTIALLY_REFUNDED' &&
            typeof payload.cumulativeRefundedPaise === 'number'
          ? `-${payload.cumulativeRefundedPaise}`
          : ''
      await this.notificationsQueue.add(NOTIFICATION_JOB_NAMES.CUSTOMER_ORDER_UPDATE, payload, {
        ...DEFAULT_QUEUE_JOB_OPTIONS,
        // Never leave plaintext pickup codes cached in Redis completed/failed lists
        ...(containsSecretCode ? { removeOnComplete: true, removeOnFail: true } : {}),
        jobId: `notify-${payload.event}-${payload.orderId}${uniqueSuffix}`,
      })
    } catch (error) {
      this.logger.error({
        alert: 'QUEUE_ENQUEUE_FAILED',
        queue: QUEUE_NAMES.NOTIFICATIONS,
        orderId: payload.orderId,
        error: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }

  async enqueueOpsAlert(payload: OpsAlertJobPayload): Promise<void> {
    if (!this.opsAlertsQueue) return
    try {
      await this.opsAlertsQueue.add(ALERT_JOB_NAMES.CRITICAL_OPS_ALERT, payload, {
        ...DEFAULT_QUEUE_JOB_OPTIONS,
      })
    } catch (error) {
      this.logger.error({
        alert: 'QUEUE_ENQUEUE_FAILED',
        queue: QUEUE_NAMES.OPS_ALERTS,
        alertKey: payload.alertKey,
        error: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }
}
