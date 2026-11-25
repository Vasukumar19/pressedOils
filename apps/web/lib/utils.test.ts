import { describe, it, expect } from 'vitest'
import { cn } from '../lib/utils'

describe('cn utility', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('handles conditional classes', () => {
    const shouldInclude = false
    expect(cn('a', shouldInclude && 'b', 'c')).toBe('a c')
  })

  it('resolves tailwind conflicts', () => {
    // tailwind-merge should keep the last conflicting class
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })
})
