import { describe, it, expect } from 'vitest'
import {
  InputValidationError,
  MintError,
  DeliveryError,
  AuditWriteError,
  validateInput,
} from '../lib/minter.js'

describe('minter error classes', () => {
  it('InputValidationError carries the "validate" step', () => {
    const e = new InputValidationError('bad tier')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('InputValidationError')
    expect(e.step).toBe('validate')
    expect(e.message).toBe('bad tier')
  })

  it('MintError carries the "mint" step', () => {
    const e = new MintError('key import failed')
    expect(e.step).toBe('mint')
  })

  it('DeliveryError carries the "deliver" step + optional lid', () => {
    const e = new DeliveryError('resend 500', { lid: 'lic_abc' })
    expect(e.step).toBe('deliver')
    expect(e.lid).toBe('lic_abc')
  })

  it('AuditWriteError carries the "audit" step + optional lastSha', () => {
    const e = new AuditWriteError('3 conflicts', { lastSha: 'abc123' })
    expect(e.step).toBe('audit')
    expect(e.lastSha).toBe('abc123')
  })
})

describe('validateInput', () => {
  const valid = {
    tier: 'enterprise',
    org: 'Bola Labs Dev',
    email: 'bruno@bolalabs.pt',
    seats: '100',
    months: '24',
    notes: 'Dev self-license',
  }

  it('accepts a fully-specified valid input and coerces numeric strings', () => {
    const result = validateInput(valid)
    expect(result).toEqual({
      tier: 'enterprise',
      org: 'Bola Labs Dev',
      email: 'bruno@bolalabs.pt',
      seats: 100,
      months: 24,
      notes: 'Dev self-license',
    })
  })

  it('accepts minimal input with defaults', () => {
    const result = validateInput({
      tier: 'pro',
      org: 'Acme',
      email: 'a@b.co',
    })
    expect(result.seats).toBe(1)
    expect(result.months).toBe(12)
    expect(result.notes).toBe('')
  })

  it('rejects unknown tier', () => {
    expect(() => validateInput({ ...valid, tier: 'free' }))
      .toThrow(/tier must be "pro" or "enterprise"/)
  })

  it('rejects empty org', () => {
    expect(() => validateInput({ ...valid, org: '' }))
      .toThrow(/org is required/)
  })

  it('rejects org longer than 200 chars', () => {
    expect(() => validateInput({ ...valid, org: 'x'.repeat(201) }))
      .toThrow(/org must be ≤ 200 characters/)
  })

  it('rejects malformed email', () => {
    expect(() => validateInput({ ...valid, email: 'not-an-email' }))
      .toThrow(/email is not a valid address/)
  })

  it('rejects email longer than 254 chars', () => {
    expect(() => validateInput({ ...valid, email: 'a'.repeat(250) + '@b.com' }))
      .toThrow(/email must be ≤ 254 characters/)
  })

  it('rejects seats < 1', () => {
    expect(() => validateInput({ ...valid, seats: '0' }))
      .toThrow(/seats must be an integer between 1 and 10000/)
  })

  it('rejects seats > 10000', () => {
    expect(() => validateInput({ ...valid, seats: '10001' }))
      .toThrow(/seats must be an integer between 1 and 10000/)
  })

  it('rejects months < 1', () => {
    expect(() => validateInput({ ...valid, months: '0' }))
      .toThrow(/months must be an integer between 1 and 24/)
  })

  it('rejects months > 24', () => {
    expect(() => validateInput({ ...valid, months: '25' }))
      .toThrow(/months must be an integer between 1 and 24/)
  })

  it('rejects notes longer than 500 chars', () => {
    expect(() => validateInput({ ...valid, notes: 'x'.repeat(501) }))
      .toThrow(/notes must be ≤ 500 characters/)
  })

  it('throws InputValidationError specifically', async () => {
    const { InputValidationError } = await import('../lib/minter.js')
    try {
      validateInput({ ...valid, tier: 'free' })
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InputValidationError)
      expect(e.step).toBe('validate')
    }
  })
})
