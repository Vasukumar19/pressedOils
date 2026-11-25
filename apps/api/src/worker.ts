import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ALERT_SEVERITY } from '@pressedoils/shared'
import { Worker } from 'bullmq'
import { Logger as PinoLogger } from 'nestjs-pino'
import { CheckoutService } from './checkout/checkout.service'
import { env } from './env'
import { NotificationsService } from './notifications/notifications.service'
import { OpsAlertService } from './queue/ops-alert.service'
import {
  ALERT_JOB_NAMES,
  MAINTENANCE_JOB_NAMES,
  NOTIFICATION_JOB_NAMES,
  QUEUE_NAMES,
} from './queue/queue.constants'
import {
  buildBullMqConnectionOptions,
  type CustomerNotificationJobPayload,
  type OpsAlertJobPayload,
  QueueService,
} from './queue/queue.service'
import { WorkerModule } from './worker.module'

async function bootstrapWorker(): Promise<void> {
  if (!env.QUEUE_REDIS_URL) {
    throw new Error('FATAL: QUEUE_REDIS_URL must be set to start the BullMQ worker')
  }

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  })
  app.useLogger(app.get(PinoLogger))

  const logger = new Logger('BullMqWorker')
  const checkoutService = app.get(CheckoutService)
  const notificationsService = app.get(NotificationsService)
  const queueService = app.get(QueueService)
  const opsAlertService = app.get(OpsAlertService)
  const connection = buildBullMqConnectionOptions(env.QUEUE_REDIS_URL)

  await queueService.registerRepeatableMaintenanceJobs()

  const maintenanceWorker = new Worker(
    QUEUE_NAMES.ORDERS_MAINTENANCE,
    async (job) => {
      if (job.name === MAINTENANCE_JOB_NAMES.RESERVATION_EXPIRY) {
        return checkoutService.releaseExpiredReservations()
      }
      if (job.name === MAINTENANCE_JOB_NAMES.RECONCILE_RECENT) {
        const data = (job.data ?? {}) as { minAgeMinutes?: number; maxAgeMinutes?: number }
        return checkoutService.reconcileStuckPayments({
          minAgeMinutes: data.minAgeMinutes ?? 2,
          maxAgeMinutes: data.maxAgeMinutes ?? 60,
        })
      }
      if (job.name === MAINTENANCE_JOB_NAMES.RECONCILE_AGING_AND_EXPIRE_24H) {
        const data = (job.data ?? {}) as { minAgeMinutes?: number; maxAgeMinutes?: number }
        return checkoutService.reconcileStuckPayments({
          minAgeMinutes: data.minAgeMinutes ?? 60,
          maxAgeMinutes: data.maxAgeMinutes ?? 24 * 60,
          expireAfterMinutes: 24 * 60,
        })
      }
      if (job.name === MAINTENANCE_JOB_NAMES.PROVIDER_HEALTH_CHECK) {
        return notificationsService.runProviderHealthAndBalanceCheck()
      }
      logger.warn({ event: 'UNKNOWN_MAINTENANCE_JOB', name: job.name, jobId: job.id })
      return { skipped: true }
    },
    { connection, concurrency: 1 },
  )

  const notificationsWorker = new Worker<CustomerNotificationJobPayload>(
    QUEUE_NAMES.NOTIFICATIONS,
    async (job) => {
      if (job.name === NOTIFICATION_JOB_NAMES.CUSTOMER_ORDER_UPDATE) {
        await notificationsService.deliverCustomerNotification(job.data)
        return { delivered: true }
      }
      return { skipped: true }
    },
    { connection, concurrency: 5 },
  )

  const opsAlertsWorker = new Worker<OpsAlertJobPayload>(
    QUEUE_NAMES.OPS_ALERTS,
    async (job) => {
      if (job.name === ALERT_JOB_NAMES.CRITICAL_OPS_ALERT) {
        await notificationsService.dispatchOwnerAlertDelivery(job.data)
        return { dispatched: true }
      }
      return { skipped: true }
    },
    { connection, concurrency: 2 },
  )

  const workers: Worker[] = [maintenanceWorker, notificationsWorker, opsAlertsWorker]

  for (const w of workers) {
    w.on('failed', (job, err) => {
      const maxAttempts = job?.opts?.attempts ?? 1
      const exhausted = Boolean(job && job.attemptsMade >= maxAttempts)
      logger.error({
        event: 'BULLMQ_JOB_FAILED',
        queue: w.name,
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        attemptsMade: job?.attemptsMade ?? 0,
        exhausted,
        error: err.message,
      })
      if (exhausted) {
        void opsAlertService.alertCritical({
          alertKey: `worker-job-exhausted-${w.name}`,
          severity: ALERT_SEVERITY.CRITICAL,
          message: `Worker job "${job?.name ?? 'unknown'}" (${job?.id ?? 'no-id'}) failed permanently on queue "${w.name}": ${err.message}`,
          details: { queue: w.name, jobId: job?.id ?? null, attemptsMade: job?.attemptsMade ?? 0 },
        })
      }
    })

    w.on('error', (err) => {
      logger.error({ event: 'BULLMQ_WORKER_ERROR', queue: w.name, error: err.message })
    })
  }

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.log({ event: 'BULLMQ_WORKER_SHUTTING_DOWN', signal })
    await Promise.all(workers.map((w) => w.close()))
    await app.close()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })

  logger.log({
    event: 'BULLMQ_WORKER_READY',
    queues: [QUEUE_NAMES.ORDERS_MAINTENANCE, QUEUE_NAMES.NOTIFICATIONS, QUEUE_NAMES.OPS_ALERTS],
  })
}

bootstrapWorker().catch((err) => {
  console.error('Worker bootstrap failed:', err)
  process.exit(1)
})
