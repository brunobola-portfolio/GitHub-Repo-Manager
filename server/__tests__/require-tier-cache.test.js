// Coverage for the require-tier license CACHE lifecycle that the existing
// require-tier-license.test.js (which exercises resolveEffectiveTier with real
// crypto) does not reach: getUserTier()'s expired-payload nullification and the
// 5-minute TTL background revalidation kicked by maybeKickLicenseRefresh().
//
// We mock license.js / license-store.js / db.js so the module-private cache can
// be driven into known states without real signing keys or a live DB. config is
// mocked to force licenseKey:null so refreshLicenseCache() always falls through
// to the DB (getStoredLicense) branch — the 'db' source whose TTL refresh we
// want to assert — regardless of a LICENSE_KEY the dev may have in their .env.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../config.js', async (importActual) => {
  const actual = await importActual()
  return { ...actual, config: { ...actual.config, licenseKey: null } }
})

vi.mock('../db.js', () => ({
  default: {
    prepare: () => ({ get: () => null, all: () => [], run: () => ({ changes: 0 }) }),
    transaction: (fn) => fn,
    exec: () => {},
    pragma: () => {},
  },
}))

vi.mock('../lib/license.js', async (importActual) => {
  const actual = await importActual()
  return { ...actual, validateLicenseKey: vi.fn(), isLicenseExpired: vi.fn() }
})

vi.mock('../lib/license-store.js', () => ({
  getStoredLicense: vi.fn(),
  setStoredLicense: vi.fn(),
  clearStoredLicense: vi.fn(),
}))

import { validateLicenseKey, isLicenseExpired } from '../lib/license.js'
import { getStoredLicense } from '../lib/license-store.js'
import {
  refreshLicenseCache,
  getUserTier,
  getLicenseInfo,
  getLicenseSource,
} from '../middleware/require-tier.js'

const TTL_MS = 5 * 60_000
const NOW = new Date('2026-01-01T00:00:00.000Z').getTime()

/** Populate the module cache with a non-expired DB-sourced license at `at`. */
async function seedDbLicense({ tier = 'pro', at = NOW } = {}) {
  vi.setSystemTime(at)
  getStoredLicense.mockReturnValue({ licenseKey: 'grm_lic_seed' })
  validateLicenseKey.mockResolvedValue({ tier, exp: 9_999_999_999, org: 'Acme' })
  isLicenseExpired.mockReturnValue(false)
  const payload = await refreshLicenseCache()
  getStoredLicense.mockClear()
  validateLicenseKey.mockClear()
  return payload
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
})

afterEach(async () => {
  // Reset the module cache to a clean (no-license) state so tests don't bleed.
  getStoredLicense.mockReturnValue(null)
  await refreshLicenseCache()
  vi.useRealTimers()
})

describe('getUserTier — expired cached payload nullification', () => {
  it('downgrades to free and clears the cache when the cached payload has expired', async () => {
    const payload = await seedDbLicense({ tier: 'enterprise' })
    expect(payload?.tier).toBe('enterprise')
    expect(getLicenseInfo()).not.toBeNull()
    expect(getLicenseSource()).toBe('db')

    // The cached payload is now reported expired.
    isLicenseExpired.mockReturnValue(true)

    expect(getUserTier('user-1')).toBe('free')
    // Cache fully cleared so a subsequent call stays free without re-checking.
    expect(getLicenseInfo()).toBeNull()
    expect(getLicenseSource()).toBeNull()
    expect(getUserTier('user-1')).toBe('free')
  })
})

describe('getUserTier — 5-minute TTL background refresh (db source)', () => {
  it('serves the cached tier and kicks a background refresh once the TTL elapses', async () => {
    await seedDbLicense({ tier: 'pro' })

    // Past the TTL: the in-flight refresh re-reads the stored license.
    vi.setSystemTime(NOW + TTL_MS + 1)
    getStoredLicense.mockReturnValue({ licenseKey: 'grm_lic_seed' })

    // Current request still serves the cached value (refresh runs in background).
    expect(getUserTier('user-1')).toBe('pro')
    // The background refresh ran synchronously up to its first await.
    expect(getStoredLicense).toHaveBeenCalledTimes(1)
    await vi.runOnlyPendingTimersAsync().catch(() => {})
  })

  it('does not refresh again while a refresh is already in flight', async () => {
    await seedDbLicense({ tier: 'pro' })
    vi.setSystemTime(NOW + TTL_MS + 1)
    getStoredLicense.mockReturnValue({ licenseKey: 'grm_lic_seed' })

    getUserTier('user-1') // kicks the refresh
    getUserTier('user-1') // in-flight guard → no second kick
    expect(getStoredLicense).toHaveBeenCalledTimes(1)
  })

  it('does not refresh while still within the TTL window', async () => {
    await seedDbLicense({ tier: 'pro' })

    vi.setSystemTime(NOW + TTL_MS - 1000) // not yet elapsed
    expect(getUserTier('user-1')).toBe('pro')
    expect(getStoredLicense).not.toHaveBeenCalled()
  })
})
