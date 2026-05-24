import { describe, it, expect } from 'vitest'
import { basicAuthHeader } from '../lib/basic-auth-header.js'

describe('basicAuthHeader', () => {
  it('builds the Azure DevOps Basic auth header (empty user, pat)', () => {
    expect(basicAuthHeader('', 'mypat')).toBe(`Basic ${Buffer.from(':mypat').toString('base64')}`)
  })

  it('handles a real username (legacy GitHub Basic)', () => {
    const h = basicAuthHeader('alice', 'token')
    expect(h).toBe(`Basic ${Buffer.from('alice:token').toString('base64')}`)
  })

  it('handles null/undefined gracefully', () => {
    expect(basicAuthHeader(null, null)).toBe(`Basic ${Buffer.from(':').toString('base64')}`)
    expect(basicAuthHeader(undefined, 'pat')).toBe(`Basic ${Buffer.from(':pat').toString('base64')}`)
  })

  it('properly base64-encodes special characters', () => {
    const h = basicAuthHeader('', 'pat with spaces & symbols')
    const decoded = Buffer.from(h.replace('Basic ', ''), 'base64').toString()
    expect(decoded).toBe(':pat with spaces & symbols')
  })
})
