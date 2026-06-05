// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { getCurrentPeriod } from '../lib/usage-meter.js'

// Monthly quota buckets (AI queries + metered migrations) key on `period_start`.
// The boundary must be a single global instant (UTC), not the host server's
// local midnight — otherwise a non-UTC server misbuckets usage near the month
// rollover and read/write can disagree across a deploy that changes TZ.
//
// These tests inject the clock and assert exact UTC ISO strings, so they are
// host-timezone-independent: the only way to derive '...-01T00:00:00.000Z'
// from a mid-month UTC instant is to compute the bounds in UTC.
describe('getCurrentPeriod — UTC month boundaries', () => {
  it('returns UTC-aligned start/end for the injected clock', () => {
    const { start, end } = getCurrentPeriod(new Date('2026-02-15T12:00:00.000Z'))
    expect(start).toBe('2026-02-01T00:00:00.000Z')
    expect(end).toBe('2026-02-28T23:59:59.000Z')
  })

  it('buckets an instant by its UTC month, not the host local month', () => {
    // 2026-07-01T02:00:00Z is still 2026-06-30 in every timezone west of UTC
    // (e.g. America/New_York = 2026-06-30T22:00). A local-time implementation
    // would misbucket this into June; the UTC implementation keeps it in July.
    const { start, end } = getCurrentPeriod(new Date('2026-07-01T02:00:00.000Z'))
    expect(start).toBe('2026-07-01T00:00:00.000Z')
    expect(end).toBe('2026-07-31T23:59:59.000Z')
  })

  it('handles the December → next-year rollover', () => {
    const { start, end } = getCurrentPeriod(new Date('2026-12-31T23:30:00.000Z'))
    expect(start).toBe('2026-12-01T00:00:00.000Z')
    expect(end).toBe('2026-12-31T23:59:59.000Z')
  })

  it('handles a leap-February end-of-month', () => {
    const { end } = getCurrentPeriod(new Date('2028-02-10T00:00:00.000Z'))
    expect(end).toBe('2028-02-29T23:59:59.000Z')
  })

  it('defaults to the real current time when no clock is injected', () => {
    const { start, end } = getCurrentPeriod()
    // First-of-month at UTC midnight, regardless of where the test runs.
    expect(start).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/)
    expect(end).toMatch(/T23:59:59\.000Z$/)
    expect(new Date(start).getTime()).toBeLessThanOrEqual(Date.now())
    expect(new Date(end).getTime()).toBeGreaterThanOrEqual(Date.now())
  })
})
