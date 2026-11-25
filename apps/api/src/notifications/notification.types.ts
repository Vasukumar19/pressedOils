import { createHmac } from 'node:crypto'

export type DltTemplateKey =
  | 'OTP'
  | 'ORDER_CONFIRMED'
  | 'ORDER_SHIPPED'
  | 'ORDER_DELIVERED'
  | 'ORDER_READY_FOR_PICKUP'
  | 'PICKUP_CODE'
  | 'OWNER_ALERT'
  | 'ORDER_UPDATE'

export interface EmailSendInput {
  to: string
  subject: string
  html: string
  text: string
  tags?: Array<{ name: string; value: string }>
}

export interface SmsSendInput {
  toPhone: string
  dltTemplateKey: DltTemplateKey
  textBody: string
  variables: Record<string, string>
}

export interface TransportSendResult {
  ok: boolean
  provider: string
  providerMessageId: string | null
  error?: string
  permanentFailure?: boolean
}

export interface TransportHealthResult {
  ok: boolean
  provider: string
  remainingCredits?: number
  details?: string
}

export interface EmailTransport {
  readonly providerName: string
  send(input: EmailSendInput): Promise<TransportSendResult>
  checkHealth(): Promise<TransportHealthResult>
}

export interface SmsTransport {
  readonly providerName: string
  send(input: SmsSendInput): Promise<TransportSendResult>
  checkHealth(): Promise<TransportHealthResult>
}

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT')
export const SMS_TRANSPORT = Symbol('SMS_TRANSPORT')

export function maskPhone(phone: string): string {
  const clean = phone.trim()
  if (clean.length <= 4) return '****'
  const last4 = clean.slice(-4)
  if (clean.startsWith('+91') && clean.length >= 10) {
    return `+91******${last4}`
  }
  return `${'*'.repeat(Math.max(4, clean.length - 4))}${last4}`
}

export function maskEmail(email: string): string {
  const clean = email.trim().toLowerCase()
  const atIndex = clean.indexOf('@')
  if (atIndex <= 0) return '***'
  const local = clean.slice(0, atIndex)
  const domain = clean.slice(atIndex + 1)
  if (local.length <= 1) return `*@${domain}`
  if (local.length === 2) return `${local[0]}*@${domain}`
  return `${local[0]}${'*'.repeat(Math.min(5, local.length - 2))}${local[local.length - 1]}@${domain}`
}

export function hashEmailForSuppression(email: string, secret: string): string {
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex')
}

export function hashPhoneForOtp(phone: string, secret: string): string {
  return createHmac('sha256', secret).update(phone.trim()).digest('hex')
}
