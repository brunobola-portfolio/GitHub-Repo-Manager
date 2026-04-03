import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, generateLicenseKey, validateLicenseKey, parseLicenseKey } from '../lib/license.js'

let privateKey, publicKey

beforeAll(async () => {
  const pair = await generateKeyPair()
  privateKey = pair.privateKey
  publicKey = pair.publicKey
})

describe('license key generation and validation', () => {
  it('should generate a key with grm_lic_ prefix', async () => {
    const key = await generateLicenseKey({
      org: 'Test Corp', email: 'test@example.com', tier: 'pro', seats: 3, months: 12,
    }, privateKey)
    expect(key).toMatch(/^grm_lic_/)
  })

  it('should validate a correctly signed key', async () => {
    const key = await generateLicenseKey({
      org: 'Test Corp', email: 'test@example.com', tier: 'pro', seats: 3, months: 12,
    }, privateKey)
    const payload = await validateLicenseKey(key, publicKey)
    expect(payload).not.toBeNull()
    expect(payload.tier).toBe('pro')
    expect(payload.org).toBe('Test Corp')
    expect(payload.seats).toBe(3)
  })

  it('should reject a tampered key', async () => {
    const key = await generateLicenseKey({
      org: 'Test Corp', email: 'test@example.com', tier: 'pro', seats: 1, months: 12,
    }, privateKey)
    const tampered = key.slice(0, -5) + 'XXXXX'
    const payload = await validateLicenseKey(tampered, publicKey)
    expect(payload).toBeNull()
  })

  it('should reject an expired key', async () => {
    const key = await generateLicenseKey({
      org: 'Expired Corp', email: 'expired@example.com', tier: 'enterprise', seats: 1, months: 0,
    }, privateKey)
    const payload = await validateLicenseKey(key, publicKey)
    expect(payload).toBeNull()
  })

  it('should parse a key without verification', async () => {
    const key = await generateLicenseKey({
      org: 'Parse Corp', email: 'parse@example.com', tier: 'enterprise', seats: 10, months: 6,
    }, privateKey)
    const payload = parseLicenseKey(key)
    expect(payload).not.toBeNull()
    expect(payload.org).toBe('Parse Corp')
    expect(payload.tier).toBe('enterprise')
  })

  it('should return null for invalid key format', async () => {
    const payload = await validateLicenseKey('not-a-valid-key', publicKey)
    expect(payload).toBeNull()
  })
})
