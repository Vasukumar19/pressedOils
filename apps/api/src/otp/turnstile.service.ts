import { Injectable, Logger } from '@nestjs/common'
import { isProductionRuntime } from '@pressedoils/shared'
import { env } from '../env'

const TURNSTILE_TIMEOUT_MS = 5000

@Injectable()
export class TurnstileService {
  static readonly NON_PROD_TEST_PASS_TOKEN = 'turnstile-dev-pass-token'
  private readonly logger = new Logger(TurnstileService.name)

  private isProdRuntime(): boolean {
    return isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })
  }

  async verifyToken(token: string | undefined, remoteIp: string): Promise<boolean> {
    if (!token || !token.trim()) {
      return false
    }

    const clean = token.trim()
    const isProd = this.isProdRuntime()

    // Allow deterministic test bypass ONLY in non-production when Turnstile secret is not configured
    if (!isProd && !env.TURNSTILE_SECRET_KEY) {
      return clean === TurnstileService.NON_PROD_TEST_PASS_TOKEN
    }

    if (!env.TURNSTILE_SECRET_KEY) {
      this.logger.warn({ event: 'TURNSTILE_SECRET_KEY_MISSING_IN_PROD' })
      return false
    }

    try {
      const form = new URLSearchParams()
      form.set('secret', env.TURNSTILE_SECRET_KEY)
      form.set('response', clean)
      form.set('remoteip', remoteIp)

      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
      })

      if (!res.ok) return false
      const json = (await res.json()) as { success?: boolean }
      return json.success === true
    } catch {
      return false
    }
  }
}
