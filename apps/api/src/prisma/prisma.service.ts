import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { env } from '../env'

export function buildPrismaDatabaseUrl(
  rawUrl: string | undefined,
  options: { poolLimit: number; poolTimeoutSeconds: number; statementTimeoutMs: number },
): string | undefined {
  if (!rawUrl) return undefined
  const parsed = new URL(rawUrl)
  if (!parsed.searchParams.has('connection_limit')) {
    parsed.searchParams.set('connection_limit', String(options.poolLimit))
  }
  if (!parsed.searchParams.has('pool_timeout')) {
    parsed.searchParams.set('pool_timeout', String(options.poolTimeoutSeconds))
  }
  if (!parsed.searchParams.has('options')) {
    parsed.searchParams.set('options', `-c statement_timeout=${options.statementTimeoutMs}`)
  }
  return parsed.toString()
}

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name)

  constructor() {
    const url = buildPrismaDatabaseUrl(env.DATABASE_URL, {
      poolLimit: env.DB_POOL_LIMIT,
      poolTimeoutSeconds: env.DB_POOL_TIMEOUT_SECONDS,
      statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    })

    super({
      datasources: url ? { db: { url } } : undefined,
      log: [{ emit: 'event', level: 'query' }],
    })

    this.$on('query', (event) => {
      if (event.duration >= env.DB_SLOW_QUERY_MS) {
        this.logger.warn({
          alert: 'SLOW_DB_QUERY',
          durationMs: event.duration,
          query: event.query.slice(0, 200),
        })
      }
    })
  }

  async onModuleInit() {
    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
