import { createHmac, timingSafeEqual } from 'node:crypto'
import { Logger } from '@nestjs/common'
import { env } from '../../env'
import type {
  EmailSendInput,
  EmailTransport,
  TransportHealthResult,
  TransportSendResult,
} from '../notification.types'

const REQUEST_TIMEOUT_MS = 8000
const WEBHOOK_TOLERANCE_SECONDS = 300

export class ResendEmailTransport implements EmailTransport {
  readonly providerName = 'resend'
  private readonly logger = new Logger(ResendEmailTransport.name)

  async send(input: EmailSendInput): Promise<TransportSendResult> {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return {
        ok: false,
        provider: this.providerName,
        providerMessageId: null,
        error: 'Resend email credentials are not configured',
      }
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const permanentFailure = res.status >= 400 && res.status < 500 && res.status !== 429
        this.logger.warn({
          event: 'RESEND_SEND_FAILED',
          status: res.status,
          permanentFailure,
        })
        return {
          ok: false,
          provider: this.providerName,
          providerMessageId: null,
          error: `Resend API error (${res.status}): ${body.slice(0, 180)}`,
          permanentFailure,
        }
      }

      const json = (await res.json()) as { id?: string }
      return {
        ok: true,
        provider: this.providerName,
        providerMessageId: json.id ?? null,
      }
    } catch (error) {
      return {
        ok: false,
        provider: this.providerName,
        providerMessageId: null,
        error: error instanceof Error ? error.message : 'Resend network failure',
      }
    }
  }

  async checkHealth(): Promise<TransportHealthResult> {
    if (!env.RESEND_API_KEY) {
      return {
        ok: false,
        provider: this.providerName,
        details: 'RESEND_API_KEY missing',
      }
    }

    try {
      const res = await fetch('https://api.resend.com/domains', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      return {
        ok: res.ok,
        provider: this.providerName,
        details: res.ok ? 'Resend API reachable' : `HTTP ${res.status}`,
      }
    } catch (error) {
      return {
        ok: false,
        provider: this.providerName,
        details: error instanceof Error ? error.message : 'Health check error',
      }
    }
  }

  /**
   * Verifies Svix/Resend webhook HMAC-SHA256 signature over exact raw body bytes.
   */
  static verifySvixSignature(input: {
    rawBody: Buffer
    svixId: string | undefined
    svixTimestamp: string | undefined
    svixSignature: string | undefined
    secret: string
  }): boolean {
    if (
      !input.svixId ||
      !input.svixTimestamp ||
      !input.svixSignature ||
      input.rawBody.length === 0
    ) {
      return false
    }
    const tsSec = Number(input.svixTimestamp)
    if (!Number.isFinite(tsSec)) return false
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - tsSec)
    if (ageSeconds > WEBHOOK_TOLERANCE_SECONDS) {
      return false
    }

    const secretRaw = input.secret.startsWith('whsec_') ? input.secret.slice(6) : input.secret
    const keyBytes = Buffer.from(secretRaw, 'base64')
    if (keyBytes.length === 0) return false

    const signedContent = `${input.svixId}.${input.svixTimestamp}.${input.rawBody.toString('utf8')}`
    const expectedSig = createHmac('sha256', keyBytes).update(signedContent).digest('base64')

    const parts = input.svixSignature
      .split(' ')
      .map((part) => part.trim())
      .filter(Boolean)
    return parts.some((entry) => {
      const [, sigVal] = entry.split(',')
      if (!sigVal) return false
      const a = Buffer.from(expectedSig, 'utf8')
      const b = Buffer.from(sigVal, 'utf8')
      return a.length === b.length && timingSafeEqual(a, b)
    })
  }
}
