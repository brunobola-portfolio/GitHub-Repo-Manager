import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { generateKeyPair, generateLicenseKey, validateLicenseKey, parseLicenseKey, isLicenseExpired, addCalendarMonths } from '../lib/license.js'

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

  it('should pass undefined kid to resolver when validating a kid-less license', async () => {
    // License signed without kid (no `kid` in opts)
    const key = await generateLicenseKey({
      org: 'Legacy Corp', email: 'legacy@example.com', tier: 'pro', seats: 1, months: 12,
    }, privateKey)

    const received = []
    const resolver = (kid) => {
      received.push(kid)
      return publicKey
    }

    const payload = await validateLicenseKey(key, resolver)
    expect(payload).not.toBeNull()
    expect(payload.tier).toBe('pro')
    expect(received).toEqual([undefined])
  })
})

describe('calendar-month expiry arithmetic (yearly-billing honesty bug)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('addCalendarMonths(1) spans a full 31-day month, not a flat 30 days', () => {
    const jan1 = Date.UTC(2026, 0, 1) / 1000 // 2026-01-01T00:00:00Z
    const result = addCalendarMonths(jan1, 1)
    expect(new Date(result * 1000).toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect((result - jan1) / 86400).toBe(31)
  })

  it('addCalendarMonths(12) lands on the same calendar date next year (365 days, non-leap window)', () => {
    const mar1_2026 = Date.UTC(2026, 2, 1) / 1000 // 2026-03-01T00:00:00Z
    const result = addCalendarMonths(mar1_2026, 12)
    expect(new Date(result * 1000).toISOString()).toBe('2027-03-01T00:00:00.000Z')
    expect((result - mar1_2026) / 86400).toBe(365)
  })

  it('addCalendarMonths(12) spans 366 days when the window crosses a leap Feb 29', () => {
    const mar1_2023 = Date.UTC(2023, 2, 1) / 1000 // 2023-03-01T00:00:00Z — next Feb (2024) is leap
    const result = addCalendarMonths(mar1_2023, 12)
    expect((result - mar1_2023) / 86400).toBe(366)
  })

  it('a 12-month license key covers a full 365/366-day cycle, not the old 360-day (months*30) shortfall', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'))
    const key = await generateLicenseKey({
      org: 'Yearly Corp', email: 'yearly@example.com', tier: 'pro', seats: 1, months: 12,
    }, privateKey)
    const payload = parseLicenseKey(key)
    const now = Math.floor(Date.now() / 1000)
    const diffDays = (payload.exp - now) / 86400
    // A real Stripe yearly cycle is 365 or 366 days — never 360.
    expect(diffDays).toBeGreaterThanOrEqual(365)
    expect(diffDays).toBeLessThanOrEqual(366)
  })

  it('a monthly license key issued in a 31-day month stays valid through day 31 (no dead day before renewal)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const key = await generateLicenseKey({
      org: 'Monthly Corp', email: 'monthly@example.com', tier: 'pro', seats: 1, months: 1,
    }, privateKey)
    const payload = parseLicenseKey(key)
    const now = Math.floor(Date.now() / 1000)
    const diffDays = (payload.exp - now) / 86400
    expect(diffDays).toBe(31)
  })
})

describe('isLicenseExpired (defence in depth)', () => {
  it('treats missing payload or exp as expired', () => {
    expect(isLicenseExpired(null)).toBe(true)
    expect(isLicenseExpired({})).toBe(true)
    expect(isLicenseExpired({ exp: undefined })).toBe(true)
  })

  it('treats payloads expiring more than 10 years out as expired (forgery guard)', () => {
    const tenYearsTwoSeconds = Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60) + 2
    expect(isLicenseExpired({ exp: tenYearsTwoSeconds })).toBe(true)
    // Year 2286 sentinel — must be rejected
    expect(isLicenseExpired({ exp: 9999999999 })).toBe(true)
  })

  it('accepts a license expiring in the next year', () => {
    const oneYear = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
    expect(isLicenseExpired({ exp: oneYear })).toBe(false)
  })

  it('treats already-past exp as expired', () => {
    const yesterday = Math.floor(Date.now() / 1000) - (24 * 60 * 60)
    expect(isLicenseExpired({ exp: yesterday })).toBe(true)
  })
})
