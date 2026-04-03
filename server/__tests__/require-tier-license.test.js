import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, generateLicenseKey } from '../lib/license.js'

let publicKeyPem, privateKeyPem

beforeAll(async () => {
  const pair = await generateKeyPair()
  privateKeyPem = pair.privateKey
  publicKeyPem = pair.publicKey
})

describe('resolveEffectiveTier', () => {
  it('should return free when no stripe and no license key', async () => {
    const { resolveEffectiveTier } = await import('../middleware/require-tier.js')
    const tier = await resolveEffectiveTier(null, null, publicKeyPem)
    expect(tier).toBe('free')
  })

  it('should return license tier when LICENSE_KEY is valid', async () => {
    const key = await generateLicenseKey({
      org: 'Test', email: 'test@test.com', tier: 'enterprise', seats: 5, months: 12,
    }, privateKeyPem)
    const { resolveEffectiveTier } = await import('../middleware/require-tier.js')
    const tier = await resolveEffectiveTier(null, key, publicKeyPem)
    expect(tier).toBe('enterprise')
  })

  it('should prefer stripe tier over license key', async () => {
    const key = await generateLicenseKey({
      org: 'Test', email: 'test@test.com', tier: 'pro', seats: 1, months: 12,
    }, privateKeyPem)
    const { resolveEffectiveTier } = await import('../middleware/require-tier.js')
    const tier = await resolveEffectiveTier('enterprise', key, publicKeyPem)
    expect(tier).toBe('enterprise')
  })

  it('should return free when license key is expired', async () => {
    const key = await generateLicenseKey({
      org: 'Expired', email: 'x@x.com', tier: 'pro', seats: 1, months: 0,
    }, privateKeyPem)
    const { resolveEffectiveTier } = await import('../middleware/require-tier.js')
    const tier = await resolveEffectiveTier(null, key, publicKeyPem)
    expect(tier).toBe('free')
  })
})
