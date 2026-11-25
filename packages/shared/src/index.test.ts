import { describe, it, expect } from 'vitest'
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '../src/index'

describe('shared enums', () => {
  it('ORDER_STATUS contains all expected states', () => {
    const states = Object.values(ORDER_STATUS)
    expect(states).toContain('PENDING_PAYMENT')
    expect(states).toContain('PAID')
    expect(states).toContain('DELIVERED')
    expect(states).toContain('CANCELLED')
    expect(states).toContain('REFUNDED')
  })

  it('PAYMENT_METHOD contains ONLINE and COD', () => {
    expect(PAYMENT_METHOD.ONLINE).toBe('ONLINE')
    expect(PAYMENT_METHOD.COD).toBe('COD')
  })

  it('PAYMENT_STATUS contains all expected states', () => {
    expect(Object.keys(PAYMENT_STATUS)).toHaveLength(4)
  })
})
