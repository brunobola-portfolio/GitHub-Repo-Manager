import { describe, it, expect } from 'vitest'
import { migrationQuotaDecision } from '../lib/migration-quota.js'

// Pure decision behind the Free-tier "1 full migration / month" meter.
//   'allow'  → proceed, do NOT charge
//   'charge' → proceed AND consume one monthly unit
//   'deny'   → 403, quota exhausted
describe('migrationQuotaDecision', () => {
  it('allows dry-run plans without charging — any tier, even past the cap', () => {
    expect(migrationQuotaDecision({ isDryRun: true, isPro: false, quotaCharged: false, currentCount: 5, cap: 1 })).toBe('allow')
  })

  it('allows Pro+ full plans without charging', () => {
    expect(migrationQuotaDecision({ isDryRun: false, isPro: true, quotaCharged: false, currentCount: 99, cap: Infinity })).toBe('allow')
  })

  it('charges a free full plan that is not yet charged and under the cap', () => {
    expect(migrationQuotaDecision({ isDryRun: false, isPro: false, quotaCharged: false, currentCount: 0, cap: 1 })).toBe('charge')
  })

  it('allows (never re-charges) a free full plan already charged — resume/retry', () => {
    expect(migrationQuotaDecision({ isDryRun: false, isPro: false, quotaCharged: true, currentCount: 1, cap: 1 })).toBe('allow')
  })

  it('denies a free full plan once the monthly cap is reached', () => {
    expect(migrationQuotaDecision({ isDryRun: false, isPro: false, quotaCharged: false, currentCount: 1, cap: 1 })).toBe('deny')
  })

  it('treats currentCount === cap as exhausted (boundary)', () => {
    expect(migrationQuotaDecision({ isDryRun: false, isPro: false, quotaCharged: false, currentCount: 1, cap: 1 })).toBe('deny')
    expect(migrationQuotaDecision({ isDryRun: false, isPro: false, quotaCharged: false, currentCount: 0, cap: 1 })).toBe('charge')
  })
})
