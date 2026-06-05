import { describe, it, expect } from 'vitest'
import { validatePatFormat } from '../../src/utils/patFormat'

// Generic, provider-agnostic client-side PAT sanity check. The SERVER
// (azure-service.validatePat) is the source of truth — this only catches
// obvious paste mistakes before a round-trip. It must NOT encode Azure-specific
// prefixes/regexes (on-prem TFS tokens vary).
describe('validatePatFormat', () => {
  it('treats empty / whitespace-only as not-ok, with no error message', () => {
    expect(validatePatFormat('').ok).toBe(false)
    expect(validatePatFormat('   ').ok).toBe(false)
    expect(validatePatFormat('').message).toBe('')
  })

  it('flags whitespace inside the token (a common copy/paste error)', () => {
    const r = validatePatFormat('abcd efgh ijkl mnop qrst')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/space|line break/i)
  })

  it('flags surrounding quotes', () => {
    expect(validatePatFormat('"abcdefghijklmnopqrstuvwx"').ok).toBe(false)
  })

  it('warns when the token is too short', () => {
    const r = validatePatFormat('short-token')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/short/i)
  })

  it('rejects absurdly long input', () => {
    expect(validatePatFormat('a'.repeat(2000)).ok).toBe(false)
  })

  it('accepts a plausible base32 Azure-style PAT (52 chars)', () => {
    expect(validatePatFormat('a'.repeat(52)).ok).toBe(true)
  })

  it('accepts a plausible base64url GitHub-style token', () => {
    expect(validatePatFormat('ghp_' + 'A1b2C3d4E5f6G7h8I9j0').ok).toBe(true)
  })

  it('warns on clearly-wrong characters (no provider-specific assumptions)', () => {
    const r = validatePatFormat('token with <weird> chars!!!!!!!!')
    expect(r.ok).toBe(false)
  })
})
