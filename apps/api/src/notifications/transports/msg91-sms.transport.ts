import { Logger } from '@nestjs/common'
import { env } from '../../env'
import type {
  DltTemplateKey,
  SmsSendInput,
  SmsTransport,
  TransportHealthResult,
  TransportSendResult,
} from '../notification.types'

const REQUEST_TIMEOUT_MS = 8000

export function resolveMsg91DltTemplateId(key: DltTemplateKey): string | undefined {
  switch (key) {
    case 'OTP':
      return env.MSG91_DLT_TEMPLATE_OTP
    case 'ORDER_CONFIRMED':
      return env.MSG91_DLT_TEMPLATE_ORDER_CONFIRMED
    case 'ORDER_SHIPPED':
      return env.MSG91_DLT_TEMPLATE_ORDER_SHIPPED
    case 'ORDER_DELIVERED':
      return env.MSG91_DLT_TEMPLATE_ORDER_DELIVERED
    case 'ORDER_READY_FOR_PICKUP':
      return env.MSG91_DLT_TEMPLATE_ORDER_READY_FOR_PICKUP
    case 'PICKUP_CODE':
      return env.MSG91_DLT_TEMPLATE_PICKUP_CODE
    case 'OWNER_ALERT':
      return env.MSG91_DLT_TEMPLATE_OWNER_ALERT
    case 'ORDER_UPDATE':
    default:
      return env.MSG91_DLT_TEMPLATE_ORDER_UPDATE
  }
}

export class Msg91SmsTransport implements SmsTransport {
  readonly providerName = 'msg91'
  private readonly logger = new Logger(Msg91SmsTransport.name)

  async send(input: SmsSendInput): Promise<TransportSendResult> {
    const templateId = resolveMsg91DltTemplateId(input.dltTemplateKey)
    if (!env.MSG91_AUTH_KEY || !env.MSG91_SENDER_ID || !templateId) {
      return {
        ok: false,
        provider: this.providerName,
        providerMessageId: null,
        error: `MSG91 configuration or DLT template ID missing (${input.dltTemplateKey})`,
      }
    }

    const mobileDigits = input.toPhone.replace(/^\+/, '')

    try {
      const res = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: {
          authkey: env.MSG91_AUTH_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template_id: templateId,
          sender: env.MSG91_SENDER_ID,
          short_url: '0',
          recipients: [
            {
              mobiles: mobileDigits,
              ...input.variables,
            },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        this.logger.warn({
          event: 'MSG91_SEND_FAILED',
          status: res.status,
          dltKey: input.dltTemplateKey,
        })
        return {
          ok: false,
          provider: this.providerName,
          providerMessageId: null,
          error: `MSG91 API error (${res.status}): ${body.slice(0, 180)}`,
          permanentFailure: res.status >= 400 && res.status < 500 && res.status !== 429,
        }
      }

      const json = (await res.json()) as { request_id?: string; message?: string; type?: string }
      if (json.type === 'error') {
        return {
          ok: false,
          provider: this.providerName,
          providerMessageId: null,
          error: json.message ?? 'MSG91 rejected flow request',
        }
      }

      return {
        ok: true,
        provider: this.providerName,
        providerMessageId: json.request_id ?? json.message ?? null,
      }
    } catch (error) {
      return {
        ok: false,
        provider: this.providerName,
        providerMessageId: null,
        error: error instanceof Error ? error.message : 'MSG91 network failure',
      }
    }
  }

  async checkHealth(): Promise<TransportHealthResult> {
    if (!env.MSG91_AUTH_KEY) {
      return {
        ok: false,
        provider: this.providerName,
        details: 'MSG91_AUTH_KEY missing',
      }
    }

    try {
      const res = await fetch(
        `https://control.msg91.com/api/balance.php?authkey=${encodeURIComponent(env.MSG91_AUTH_KEY)}&type=4`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      const text = (await res.text()).trim()
      const parsedBalance = Number(text)
      if (!res.ok || !Number.isFinite(parsedBalance)) {
        return {
          ok: false,
          provider: this.providerName,
          details: `Unexpected MSG91 balance response (${res.status}): ${text.slice(0, 80)}`,
        }
      }
      return {
        ok: true,
        provider: this.providerName,
        remainingCredits: Math.floor(parsedBalance),
        details: `SMS balance: ${Math.floor(parsedBalance)} credits`,
      }
    } catch (error) {
      return {
        ok: false,
        provider: this.providerName,
        details: error instanceof Error ? error.message : 'MSG91 balance check failed',
      }
    }
  }
}
