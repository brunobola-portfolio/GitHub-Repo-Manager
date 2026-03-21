// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encryptCredentials, decryptCredentials, isSchedulingEnabled } from '../lib/credential-encryption.js'

describe('credential-encryption', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-at-least-32-chars-long!!'
  })

  it('encrypts and decrypts credentials roundtrip', () => {
    const creds = { githubToken: 'ghp_abc123', azurePat: 'pat_xyz789' }
    const encrypted = encryptCredentials(creds)
    expect(encrypted).not.toContain('ghp_abc123')
    expect(encrypted).not.toContain('pat_xyz789')
    const decrypted = decryptCredentials(encrypted)
    expect(decrypted).toEqual(creds)
  })

  it('produces different ciphertext each time (random IV)', () => {
    const creds = { githubToken: 'token' }
    const a = encryptCredentials(creds)
    const b = encryptCredentials(creds)
    expect(a).not.toBe(b)
  })

  it('throws on tampered ciphertext', () => {
    const creds = { githubToken: 'token' }
    const encrypted = encryptCredentials(creds)
    const tampered = encrypted.slice(0, -4) + 'XXXX'
    expect(() => decryptCredentials(tampered)).toThrow()
  })

  it('reports scheduling disabled when SESSION_SECRET missing', () => {
    delete process.env.SESSION_SECRET
    expect(isSchedulingEnabled()).toBe(false)
  })

  it('reports scheduling enabled when SESSION_SECRET set', () => {
    expect(isSchedulingEnabled()).toBe(true)
  })
})
