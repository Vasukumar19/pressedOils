import { isProductionRuntime, shouldShowSampleDataBanner } from '@pressedoils/shared'

function normalizeBaseUrl(raw: string, fallback: string): string {
  const candidate = raw.trim() || fallback
  try {
    const parsed = new URL(candidate)
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return fallback
  }
}

export function getServerApiBaseUrl(): string {
  return normalizeBaseUrl(
    process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '',
    'http://localhost:4000/api',
  )
}

export function getPublicApiBaseUrl(): string {
  return normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL ?? '', 'http://localhost:4000/api')
}

export function getAllowedReportDomains(): string[] {
  const raw = process.env.CDN_ALLOWED_HOSTS ?? process.env.NEXT_PUBLIC_CDN_ALLOWED_HOSTS ?? ''
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

export function isStorefrontProdRuntime(): boolean {
  return isProductionRuntime({
    APP_ENV: process.env.APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    IS_PRODUCTION_DB: process.env.IS_PRODUCTION_DB,
  })
}

export function getStorefrontShowSampleBanner(): boolean {
  return shouldShowSampleDataBanner({
    APP_ENV: process.env.APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    IS_PRODUCTION_DB: process.env.IS_PRODUCTION_DB,
    SHOW_SAMPLE_DATA_BANNER: process.env.SHOW_SAMPLE_DATA_BANNER,
  })
}

export function getRevalidateSecret(): string | null {
  const secret = process.env.REVALIDATE_SECRET?.trim()
  return secret && secret.length >= 8 ? secret : null
}

export function isStagingStorefront(): boolean {
  return process.env.APP_ENV === 'staging' || process.env.VERCEL_ENV === 'preview'
}
