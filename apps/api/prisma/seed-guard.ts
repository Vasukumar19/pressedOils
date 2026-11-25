export interface SeedEnv {
  NODE_ENV?: string
  APP_ENV?: string
  VERCEL_ENV?: string
  IS_PRODUCTION_DB?: string
  DATABASE_URL?: string
  ALLOW_DEV_SEED_IN_TEST?: string
  [key: string]: string | undefined
}

const PRODUCTION_URL_INDICATORS = [
  'rds.amazonaws.com',
  'prod.',
  '.prod',
  'production',
  'neon.tech',
  'supabase.co',
  'railway.app',
  'render.com',
]

/**
 * Checks whether a DATABASE_URL looks like a non-local / production database.
 * Localhost, 127.0.0.1, docker service hostnames ('postgres', 'db') and test DBs are allowed.
 */
export function isProductionDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false
  const lower = databaseUrl.toLowerCase()

  try {
    const parsed = new URL(lower)
    const host = parsed.hostname
    const isLocalHost =
      host === 'localhost' || host === '127.0.0.1' || host === 'postgres' || host === 'db'
    if (isLocalHost) {
      return parsed.pathname.includes('prod')
    }
    return PRODUCTION_URL_INDICATORS.some((pattern) => lower.includes(pattern))
  } catch {
    return PRODUCTION_URL_INDICATORS.some((pattern) => lower.includes(pattern))
  }
}

/**
 * Hard fence for seed:dev. Refuses to execute if NODE_ENV=production,
 * APP_ENV=production, IS_PRODUCTION_DB=true, or DATABASE_URL points at production.
 */
export function assertDevSeedAllowed(env: SeedEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to run seed:dev when NODE_ENV=production')
  }
  if (env.APP_ENV === 'production' || env.VERCEL_ENV === 'production') {
    throw new Error('Refusing to run seed:dev when APP_ENV/VERCEL_ENV is production')
  }
  if (env.IS_PRODUCTION_DB === 'true') {
    throw new Error('Refusing to run seed:dev when IS_PRODUCTION_DB=true')
  }
  if (isProductionDatabaseUrl(env.DATABASE_URL)) {
    throw new Error('Refusing to run seed:dev against a production DATABASE_URL')
  }
}
