export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitBreakerOptions {
  failureThreshold: number
  resetTimeoutMs: number
  now?: () => number
  onStateChange?: (from: CircuitState, to: CircuitState, reason?: string) => void
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private consecutiveFailures = 0
  private openedAt = 0
  private readonly now: () => number

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.options.resetTimeoutMs) {
      this.transition('HALF_OPEN', 'cooldown elapsed')
    }
    return this.state
  }

  isExecutionAllowed(): boolean {
    const current = this.getState()
    return current === 'CLOSED' || current === 'HALF_OPEN'
  }

  recordSuccess(): void {
    const current = this.getState()
    this.consecutiveFailures = 0
    if (current !== 'CLOSED') {
      this.transition('CLOSED', 'probe succeeded')
    }
  }

  recordFailure(reason?: string): void {
    this.consecutiveFailures += 1
    const current = this.getState()
    if (current === 'HALF_OPEN' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.openedAt = this.now()
      this.transition('OPEN', reason)
    }
  }

  private transition(to: CircuitState, reason?: string): void {
    if (this.state === to) return
    const from = this.state
    this.state = to
    this.options.onStateChange?.(from, to, reason)
  }
}
