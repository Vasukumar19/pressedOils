import type { JobsOptions } from 'bullmq'

export const QUEUE_NAMES = {
  ORDERS_MAINTENANCE: 'orders-maintenance',
  NOTIFICATIONS: 'notifications',
  OPS_ALERTS: 'ops-alerts',
} as const

export const MAINTENANCE_JOB_NAMES = {
  RESERVATION_EXPIRY: 'reservation-expiry',
  RECONCILE_RECENT: 'reconcile-recent',
  RECONCILE_AGING_AND_EXPIRE_24H: 'reconcile-aging-24h',
  PROVIDER_HEALTH_CHECK: 'provider-health-check',
} as const

export const NOTIFICATION_JOB_NAMES = {
  CUSTOMER_ORDER_UPDATE: 'customer-order-update',
} as const

export const ALERT_JOB_NAMES = {
  CRITICAL_OPS_ALERT: 'critical-ops-alert',
} as const

export const REPEATABLE_SCHEDULER_IDS = {
  RESERVATION_EXPIRY_1M: 'sched-reservation-expiry-1m',
  RECONCILE_RECENT_2M: 'sched-reconcile-recent-2m',
  RECONCILE_AGING_30M: 'sched-reconcile-aging-30m',
  PROVIDER_HEALTH_30M: 'sched-provider-health-30m',
} as const

export const DEFAULT_QUEUE_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 5_000,
  },
  removeOnComplete: {
    count: 500,
  },
  removeOnFail: false,
}
