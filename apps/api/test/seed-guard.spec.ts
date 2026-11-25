import { describe, expect, it } from 'vitest'
import { assertDevSeedAllowed, isProductionDatabaseUrl } from '../prisma/seed-guard'

describe('seed-guard', () => {
  it('refuses when NODE_ENV=production', () => {
    expect(() =>
      assertDevSeedAllowed({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://pressedoils:pass@localhost:5432/pressedoils',
      }),
    ).toThrow(/NODE_ENV=production/)
  })

  it('refuses when APP_ENV=production or VERCEL_ENV=production', () => {
    expect(() =>
      assertDevSeedAllowed({
        NODE_ENV: 'development',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://pressedoils:pass@localhost:5432/pressedoils',
      }),
    ).toThrow(/production/)

    expect(() =>
      assertDevSeedAllowed({
        NODE_ENV: 'development',
        VERCEL_ENV: 'production',
        DATABASE_URL: 'postgresql://pressedoils:pass@localhost:5432/pressedoils',
      }),
    ).toThrow(/production/)
  })

  it('refuses when IS_PRODUCTION_DB=true', () => {
    expect(() =>
      assertDevSeedAllowed({
        NODE_ENV: 'development',
        IS_PRODUCTION_DB: 'true',
        DATABASE_URL: 'postgresql://pressedoils:pass@localhost:5432/pressedoils',
      }),
    ).toThrow(/IS_PRODUCTION_DB=true/)
  })

  it('refuses production-looking DATABASE_URL hosts or db names', () => {
    expect(isProductionDatabaseUrl('postgresql://u:p@my-db.rds.amazonaws.com:5432/app')).toBe(true)
    expect(isProductionDatabaseUrl('postgresql://u:p@ep-cool.neon.tech:5432/main')).toBe(true)
    expect(isProductionDatabaseUrl('postgresql://u:p@localhost:5432/pressedoils_prod')).toBe(true)

    expect(() =>
      assertDevSeedAllowed({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@my-db.rds.amazonaws.com:5432/app',
      }),
    ).toThrow(/production DATABASE_URL/)
  })

  it('allows local development and CI postgres URLs', () => {
    expect(() =>
      assertDevSeedAllowed({
        NODE_ENV: 'development',
        APP_ENV: 'development',
        IS_PRODUCTION_DB: 'false',
        DATABASE_URL: 'postgresql://pressedoils:pass@localhost:5432/pressedoils',
      }),
    ).not.toThrow()
  })
})
