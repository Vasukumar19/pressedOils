export const CURRENCY = 'INR' as const
export const RESERVATION_TTL_MINUTES = 15 as const
export const DEFAULT_MAX_QTY_PER_VARIANT = 10 as const
export const DEFAULT_PAGE_SIZE = 12 as const
export const MAX_PAGE_SIZE = 24 as const
export const SIZE_LABELS = ['500 ml', '1 L', '5 L'] as const
export type SizeLabel = (typeof SIZE_LABELS)[number]

export const INDIA_TIMEZONE = 'Asia/Kolkata' as const
export const PLACEHOLDER_PATH_PREFIX = '/placeholders/' as const

export const SETTING_KEYS = {
  FREE_SHIPPING_THRESHOLD_PAISE: 'free_shipping_threshold_paise',
  FREE_SHIPPING_CONFIG: 'free_shipping_config',
  DEFAULT_SHIPPING_PAISE: 'default_shipping_paise',
  GST_CONFIG: 'gst_config',
  TAX_DISPLAY_CONFIG: 'tax_display_config',
  STORE_PICKUP_CONFIG: 'store_pickup_config',
  STORE_INFO: 'store_info',
  REQUIRE_LAB_REPORT_FOR_ACTIVATION: 'require_lab_report_for_activation',
} as const

export const CART_RATE_LIMITS = {
  SESSION_PER_MIN: 60,
  IP_PER_MIN: 300,
  INVALID_COUPON_LIMIT: 10,
  INVALID_COUPON_WINDOW_SECONDS: 15 * 60,
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

/** Returns true if an image URL points to the dev/staging /placeholders/ directory. */
export function isPlaceholderUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase()
  if (normalized.startsWith(PLACEHOLDER_PATH_PREFIX) || normalized === '/placeholders') {
    return true
  }
  try {
    const parsed = new URL(normalized)
    return parsed.pathname.startsWith(PLACEHOLDER_PATH_PREFIX)
  } catch {
    return normalized.includes(PLACEHOLDER_PATH_PREFIX)
  }
}

/**
 * Validates that a lab report URL is HTTPS, not a placeholder, and hosted on an
 * explicitly allowlisted storage/CDN domain.
 */
export function isTrustedLabReportUrl(
  url: string | null | undefined,
  allowedDomains: readonly string[],
): url is string {
  if (!url) return false
  const trimmed = url.trim()
  if (!trimmed || isPlaceholderUrl(trimmed)) return false

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:') return false
  if (allowedDomains.length === 0) return false

  const hostname = parsed.hostname.toLowerCase()
  return allowedDomains.some((domain) => {
    const clean = domain.trim().toLowerCase()
    return clean.length > 0 && (hostname === clean || hostname.endsWith(`.${clean}`))
  })
}

export interface RuntimeEnvFlags {
  NODE_ENV?: string
  APP_ENV?: string
  VERCEL_ENV?: string
  IS_PRODUCTION_DB?: string
  SHOW_SAMPLE_DATA_BANNER?: string
  DATABASE_URL?: string
}

/**
 * Returns true if any production indicator is set.
 * Used to strictly fence dev/staging seeds, placeholder images, and sample banners.
 */
export function isProductionRuntime(env: RuntimeEnvFlags): boolean {
  return (
    env.APP_ENV === 'production' ||
    env.VERCEL_ENV === 'production' ||
    env.IS_PRODUCTION_DB === 'true'
  )
}

/**
 * Sample-data banner is strictly restricted to dev and staging.
 * Even if SHOW_SAMPLE_DATA_BANNER='true' is accidentally set in production, this returns false.
 */
export function shouldShowSampleDataBanner(env: RuntimeEnvFlags): boolean {
  if (isProductionRuntime(env)) return false
  return env.SHOW_SAMPLE_DATA_BANNER === 'true'
}

/** Formats integer paise to INR string without fractional paise when whole rupees. */
export function formatPaiseToInr(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new RangeError(`Money amount must be integer paise, received: ${paise}`)
  }
  const rupees = paise / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees)
}

/** Displays a stored Date or ISO date string in India Standard Time (Asia/Kolkata). */
export function formatDateIndia(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date value: ${String(value)}`)
  }
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}
