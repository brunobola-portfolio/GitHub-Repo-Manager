import { describe, it, expect } from 'vitest'
import {
  InputValidationError,
  MintError,
  DeliveryError,
  AuditWriteError,
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
