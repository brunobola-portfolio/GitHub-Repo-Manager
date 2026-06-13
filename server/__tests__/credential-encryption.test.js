// @vitest-environment node
import crypto from 'crypto'
import { describe, it, expect, beforeEach } from 'vitest'
import { encryptCredentials, decryptCredentials, isSchedulingEnabled } from '../lib/credential-encryption.js'

// Secret the module resolves to in this suite (SESSION_SECRET fallback, set
// in beforeEach). The v1 fixture below MUST use the exact same value so the
// derived keys match.
const TEST_SECRET = 'test-secret-at-least-32-chars-long!!'

/**
 * Replicate the LEGACY v1 blob scheme exactly as the module produced it
 * before the v2 KDF bump, so we can prove decryptCredentials() still reads
 * pre-migration stored PATs:
 *   - PBKDF2-SHA256 @ 100000 iters, key length 32
 *   - KDF context Buffer 'grm-credential-v1' + secret
 *   - AES-256-GCM, IV 12 bytes, tag 16 bytes, salt 16 bytes
 *   - layout salt(16) | iv(12) | tag(16) | ciphertext, hex, NO version prefix
 */
function encryptV1(credentials, secret) {
  const SALT_LENGTH = 16
  const IV_LENGTH = 12
  const KEY_LENGTH = 32
  const salt = crypto.randomBytes(SALT_LENGTH)
  const context = Buffer.from('grm-credential-v1')
  const material = Buffer.concat([context, Buffer.from(secret)])
  const key = crypto.pbkdf2Sync(material, salt, 100000, KEY_LENGTH, 'sha256')
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = JSON.stringify(credentials)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // NO 'v2:' prefix — this is exactly what a legacy stored blob looked like.
  return Buffer.concat([salt, iv, tag, encrypted]).toString('hex')
}

describe('credential-encryption', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = TEST_SECRET
  })

  it('encrypts and decrypts credentials roundtrip', () => {
    const creds = { githubToken: 'ghp_abc123', azurePat: 'pat_xyz789' }
    const encrypted = encryptCredentials(creds)
    expect(encrypted).not.toContain('ghp_abc123')
    expect(encrypted).not.toContain('pat_xyz789')
    const decrypted = decryptCredentials(encrypted)
    expect(decrypted).toEqual(creds)
  })

  it('emits a v2-prefixed blob and round-trips it', () => {
    const creds = { githubToken: 'ghp_v2roundtrip', azurePat: 'pat_v2roundtrip' }
    const encrypted = encryptCredentials(creds)
    // The KDF version is encoded in the blob prefix, not the context.
    expect(encrypted.startsWith('v2:')).toBe(true)
    expect(decryptCredentials(encrypted)).toEqual(creds)
  })

  it('still decrypts legacy v1 (no-prefix) blobs after the v2 KDF bump', () => {
    // Generate a v1 blob in-test with the legacy scheme + the SAME secret the
    // module resolves to, guaranteeing the v1→v2 migration never strands
    // existing stored PATs.
    const creds = { githubToken: 'ghp_legacy_v1', azurePat: 'pat_legacy_v1' }
    const v1blob = encryptV1(creds, TEST_SECRET)

    // Sanity: a true v1 blob carries no version prefix and leaks no secret.
    expect(v1blob.startsWith('v2:')).toBe(false)
    expect(v1blob).not.toContain('ghp_legacy_v1')
    expect(v1blob).not.toContain('pat_legacy_v1')

    expect(decryptCredentials(v1blob)).toEqual(creds)
  })

  it('throws when a v2 blob is tampered (flipped byte)', () => {
    const creds = { githubToken: 'tamper-target' }
    const encrypted = encryptCredentials(creds)
    expect(encrypted.startsWith('v2:')).toBe(true)

    // Flip a single hex nibble in the ciphertext region (past the 'v2:'
    // prefix) — GCM auth must reject it.
    const prefix = 'v2:'
    const hex = encrypted.slice(prefix.length)
    const idx = hex.length - 2 // inside the ciphertext, well past salt/iv/tag start
    const orig = hex[idx]
    const flipped = orig === 'a' ? 'b' : 'a'
    const tamperedHex = hex.slice(0, idx) + flipped + hex.slice(idx + 1)
    const tampered = prefix + tamperedHex

    expect(tampered).not.toBe(encrypted)
    expect(() => decryptCredentials(tampered)).toThrow()
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
