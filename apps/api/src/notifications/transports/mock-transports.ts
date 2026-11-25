import { randomUUID } from 'node:crypto'
import { isProductionRuntime } from '@pressedoils/shared'
import { env } from '../../env'
import type {
  EmailSendInput,
  EmailTransport,
  SmsSendInput,
  SmsTransport,
  TransportHealthResult,
  TransportSendResult,
} from '../notification.types'

export interface CapturedEmailMessage extends EmailSendInput {
  id: string
  sentAt: string
}

export interface CapturedSmsMessage extends SmsSendInput {
  id: string
  sentAt: string
}

function assertNotProductionMock(kind: string): void {
  if (
    isProductionRuntime({
      APP_ENV: env.APP_ENV,
      IS_PRODUCTION_DB: env.IS_PRODUCTION_DB,
    })
  ) {
    throw new Error(`FATAL: Mock ${kind} transport cannot be instantiated in production runtime`)
  }
}

export class MockEmailTransport implements EmailTransport {
  readonly providerName = 'mock'
  readonly outbox: CapturedEmailMessage[] = []
  private failNext = false
  private healthy = true

  constructor() {
    assertNotProductionMock('email')
  }

  async send(input: EmailSendInput): Promise<TransportSendResult> {
    assertNotProductionMock('email')
    if (this.failNext) {
      this.failNext = false
      return {
        ok: false,
        provider: this.providerName,
        providerMessageId: null,
        error: 'Simulated mock email failure',
      }
    }
    const id = `mock_email_${randomUUID().slice(0, 12)}`
    this.outbox.push({
      ...input,
      id,
      sentAt: new Date().toISOString(),
    })
    return {
      ok: true,
      provider: this.providerName,
      providerMessageId: id,
    }
  }

  async checkHealth(): Promise<TransportHealthResult> {
    return {
      ok: this.healthy,
      provider: this.providerName,
      details: this.healthy
        ? 'Mock email transport healthy'
        : 'Simulated unhealthy email transport',
    }
  }

  clear(): void {
    this.outbox.length = 0
    this.failNext = false
    this.healthy = true
  }

  setFailNext(fail: boolean): void {
    this.failNext = fail
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy
  }
}

export class MockSmsTransport implements SmsTransport {
  readonly providerName = 'mock'
  readonly outbox: CapturedSmsMessage[] = []
  private failNext = false
  private healthy = true
  private balance = 2500

  constructor() {
    assertNotProductionMock('SMS')
  }

  async send(input: SmsSendInput): Promise<TransportSendResult> {
    assertNotProductionMock('SMS')
    if (this.failNext) {
      this.failNext = false
      return {
        ok: false,
        provider: this.providerName,
        providerMessageId: null,
        error: 'Simulated mock SMS failure',
      }
    }
    const id = `mock_sms_${randomUUID().slice(0, 12)}`
    this.outbox.push({
      ...input,
      id,
      sentAt: new Date().toISOString(),
    })
    return {
      ok: true,
      provider: this.providerName,
      providerMessageId: id,
    }
  }

  async checkHealth(): Promise<TransportHealthResult> {
    return {
      ok: this.healthy,
      provider: this.providerName,
      remainingCredits: this.balance,
      details: `Mock SMS balance: ${this.balance}`,
    }
  }

  clear(): void {
    this.outbox.length = 0
    this.failNext = false
    this.healthy = true
    this.balance = 2500
  }

  setFailNext(fail: boolean): void {
    this.failNext = fail
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy
  }

  setBalance(balance: number): void {
    this.balance = balance
  }
}
