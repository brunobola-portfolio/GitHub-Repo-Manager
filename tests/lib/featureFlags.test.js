import { describe, it, expect, beforeEach } from 'vitest'
import { isEnabled, setFlag, getDefault } from '../../src/lib/featureFlags.js'

beforeEach(() => {
  try { localStorage.clear() } catch { /* ignore */ }
})

describe('featureFlags.isEnabled', () => {
  it('returns true for DEFAULT_ON flags with no localStorage override (inbox)', () => {
    expect(isEnabled('inbox')).toBe(true)
  })

  it('respects explicit "0" override even for DEFAULT_ON flags', () => {
    setFlag('inbox', false)
    expect(isEnabled('inbox')).toBe(false)
  })

  it('respects explicit "1" override for DEFAULT_ON flags', () => {
    setFlag('inbox', true)
    expect(isEnabled('inbox')).toBe(true)
  })

  it('returns false for unknown flags', () => {
    expect(isEnabled('does-not-exist')).toBe(false)
  })

  it('returns true for unknown flag when explicitly set to "1"', () => {
    setFlag('experimental', true)
    expect(isEnabled('experimental')).toBe(true)
  })
})

describe('featureFlags.setFlag', () => {
  it('writes "1" / "0" to localStorage so isEnabled can distinguish override from default', () => {
    setFlag('inbox', true)
    expect(localStorage.getItem('dashboard_premium_v2_inbox')).toBe('1')
    setFlag('inbox', false)
    expect(localStorage.getItem('dashboard_premium_v2_inbox')).toBe('0')
  })

  it('null/undefined resets to default', () => {
    setFlag('inbox', false)
    setFlag('inbox', null)
    expect(localStorage.getItem('dashboard_premium_v2_inbox')).toBe(null)
    expect(isEnabled('inbox')).toBe(true) // back to default
  })
})

describe('featureFlags.getDefault', () => {
  it('reports default true for DEFAULT_ON flags', () => {
    expect(getDefault('inbox')).toBe(true)
  })
  it('reports default false for unknown flags', () => {
    expect(getDefault('mystery')).toBe(false)
  })
})
