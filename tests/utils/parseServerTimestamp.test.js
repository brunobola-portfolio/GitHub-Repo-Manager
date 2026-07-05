import { describe, it, expect, afterAll } from 'vitest'

// Force a non-UTC zone BEFORE the assertions run so a bare `new Date(naiveStr)`
// (the bug parseServerTimestamp fixes) resolves to a DIFFERENT epoch than the
// intended UTC one. Node re-reads process.env.TZ on each Date operation, so the
// helper's Z-append is the only thing that keeps these assertions green here.
const ORIGINAL_TZ = process.env.TZ
process.env.TZ = 'America/New_York'
afterAll(() => { process.env.TZ = ORIGINAL_TZ })

// Imported after the TZ mutation. format.js reads no timezone at import time —
// only at call time inside each test body — so ordering is safe.
const { parseServerTimestamp, formatRelativeTime, formatDateTime } = await import('@/utils/format')

const pad = (n) => String(n).padStart(2, '0')
const naiveUtc = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
  `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`

describe('parseServerTimestamp', () => {
  it('treats a naive SQLite timestamp as UTC regardless of local zone', () => {
    // 'YYYY-MM-DD HH:MM:SS' with no zone marker → the server meant UTC.
    const d = parseServerTimestamp('2026-07-05 12:34:56')
    expect(d.getTime()).toBe(Date.UTC(2026, 6, 5, 12, 34, 56))
  })

  it('handles a T-separated naive timestamp (no zone) as UTC', () => {
    const d = parseServerTimestamp('2026-01-02T03:04:05')
    expect(d.getTime()).toBe(Date.UTC(2026, 0, 2, 3, 4, 5))
  })

  it('handles naive timestamps with fractional seconds as UTC', () => {
    const d = parseServerTimestamp('2026-07-05 12:34:56.789')
    expect(d.getTime()).toBe(Date.UTC(2026, 6, 5, 12, 34, 56, 789))
  })

  it('proves the fix: a bare new Date() of the same naive string differs in a non-UTC zone', () => {
    // Only meaningful when the worker actually runs in a non-UTC zone.
    if (new Date('2026-07-05T12:00:00').getTimezoneOffset() !== 0) {
      const naive = new Date('2026-07-05 12:00:00').getTime()  // the bug: read as local
      const utc = Date.UTC(2026, 6, 5, 12, 0, 0)
      expect(naive).not.toBe(utc)
      expect(parseServerTimestamp('2026-07-05 12:00:00').getTime()).toBe(utc)  // the fix
    }
  })

  it('passes ISO strings that already carry a Z through unchanged', () => {
    const d = parseServerTimestamp('2026-07-05T12:00:00Z')
    expect(d.getTime()).toBe(Date.UTC(2026, 6, 5, 12, 0, 0))
  })

  it('passes ISO strings with an explicit offset through unchanged', () => {
    const d = parseServerTimestamp('2026-07-05T12:00:00+02:00')
    expect(d.getTime()).toBe(Date.UTC(2026, 6, 5, 10, 0, 0))
  })

  it('returns epoch numbers and Date instances as absolute values', () => {
    const epoch = Date.UTC(2026, 6, 5, 12, 0, 0)
    expect(parseServerTimestamp(epoch).getTime()).toBe(epoch)
    const dt = new Date(epoch)
    expect(parseServerTimestamp(dt)).toBe(dt)
  })

  it('returns null for nullish, empty, or unparseable input', () => {
    expect(parseServerTimestamp(null)).toBeNull()
    expect(parseServerTimestamp(undefined)).toBeNull()
    expect(parseServerTimestamp('')).toBeNull()
    expect(parseServerTimestamp('   ')).toBeNull()
    expect(parseServerTimestamp('not-a-date')).toBeNull()
    expect(parseServerTimestamp(Number.NaN)).toBeNull()
  })
})

describe('format.js consumers route through parseServerTimestamp', () => {
  it('formatRelativeTime reads a naive server timestamp as UTC (not local)', () => {
    const twoHoursAgo = naiveUtc(new Date(Date.now() - 2 * 3600_000))
    // Correct (UTC) parse → '2h ago'. A local parse in NY would be off by 4h.
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago')
  })

  it('formatDateTime renders the same wall-clock instant for naive and Z forms', () => {
    const naive = '2026-07-05 12:00:00'
    const withZ = '2026-07-05T12:00:00Z'
    expect(formatDateTime(naive)).toBe(formatDateTime(withZ))
  })
})
