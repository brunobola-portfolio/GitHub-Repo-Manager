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

  it('should include kid in the JWT header', async () => {
    const key = await generateLicenseKey({
      org: 'Test Corp', email: 'test@example.com', tier: 'pro', seats: 1, months: 12,
      kid: 'k-test-01',
    }, privateKey)
    const jwt = key.slice('grm_lic_'.length)
    const headerB64 = jwt.split('.')[0]
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
    expect(header.kid).toBe('k-test-01')
    expect(header.alg).toBe('EdDSA')
  })

  it('should reject a key signed with a disallowed algorithm', async () => {
    // Manually craft a JWT with HS256 using the public key as a shared secret
    // This simulates the classic "alg confusion" attack pattern
    const { SignJWT } = await import('jose')
    const forgedJwt = await new SignJWT({ lid: 'x', tier: 'enterprise', org: 'Attacker', seats: 9999 })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(new Date('2100-01-01').getTime() / 1000))
      .sign(new TextEncoder().encode(publicKey))
    const forged = 'grm_lic_' + forgedJwt
    const payload = await validateLicenseKey(forged, publicKey)
    expect(payload).toBeNull()
  })

  it('should validate using a resolveKeyByKid lookup function', async () => {
    const key = await generateLicenseKey({
      org: 'Resolver Corp', email: 'r@example.com', tier: 'pro', seats: 2, months: 12,
      kid: 'k-alpha',
    }, privateKey)

    const calls = []
    const resolver = (kid) => {
      calls.push(kid)
      return publicKey // single-key Phase 1 stub: return the one known key regardless of kid
    }

    const payload = await validateLicenseKey(key, resolver)
    expect(payload).not.toBeNull()
    expect(payload.tier).toBe('pro')
    expect(calls).toEqual(['k-alpha'])
  })

  it('should return null when resolver returns nothing', async () => {
    const key = await generateLicenseKey({
      org: 'Unknown Corp', email: 'u@example.com', tier: 'pro', seats: 1, months: 12,
      kid: 'k-unknown',
    }, privateKey)
    const payload = await validateLicenseKey(key, () => null)
    expect(payload).toBeNull()
  })
})
