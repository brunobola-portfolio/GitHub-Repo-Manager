import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatNumber,
  formatCompact,
  formatPercentage,
  formatFileSize,
  formatRelativeTime
} from './format'

describe('formatNumber', () => {
  it('formats numbers with thousand separators (pt-PT)', () => {
    // pt-PT uses non-breaking space or regular space, result could be "1234" or "1 234" depending on browser
    const result1 = formatNumber(1234)
    expect(result1).toMatch(/1[\s\u00A0.]?234/)

    const result2 = formatNumber(1234567)
    expect(result2).toMatch(/1[\s\u00A0.]234[\s\u00A0.]567/)
  })

  it('formats numbers with thousand separators (en-US)', () => {
    expect(formatNumber(1234, { locale: 'en-US' })).toBe('1,234')
    expect(formatNumber(1234567, { locale: 'en-US' })).toBe('1,234,567')
  })

  it('handles decimal places', () => {
    const result = formatNumber(1234.5678, {
      locale: 'en-US',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
    expect(result).toBe('1,234.57')
  })

  it('formats compact notation', () => {
    const result = formatNumber(1500, {
      locale: 'en-US',
      notation: 'compact',
      compactDisplay: 'short'
    })
    // Compact notation might round differently depending on locale
    expect(result).toMatch(/[12](\.\d)?K/)
  })

  it('handles null and undefined', () => {
    expect(formatNumber(null)).toBe('0')
    expect(formatNumber(undefined)).toBe('0')
  })

  it('handles NaN values', () => {
    expect(formatNumber(NaN)).toBe('0')
    expect(formatNumber('not a number')).toBe('0')
  })

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0')
  })

  it('handles negative numbers', () => {
    const result = formatNumber(-1234, { locale: 'en-US' })
    expect(result).toBe('-1,234')
  })

  it('handles very large numbers', () => {
    const result = formatNumber(1234567890123, { locale: 'en-US' })
    expect(result).toBe('1,234,567,890,123')
  })
})

describe('formatCompact', () => {
  it('formats numbers in compact form (en-US)', () => {
    expect(formatCompact(999, 'en-US')).toBe('999')
    expect(formatCompact(1000, 'en-US')).toBe('1K')
    expect(formatCompact(1500, 'en-US')).toBe('1.5K')
    expect(formatCompact(1000000, 'en-US')).toBe('1M')
    expect(formatCompact(1500000, 'en-US')).toBe('1.5M')
    expect(formatCompact(1000000000, 'en-US')).toBe('1B')
    expect(formatCompact(1500000000, 'en-US')).toBe('1.5B')
  })

  it('handles null and undefined', () => {
    expect(formatCompact(null)).toBe('0')
    expect(formatCompact(undefined)).toBe('0')
  })

  it('handles NaN values', () => {
    expect(formatCompact(NaN)).toBe('0')
  })

  it('handles zero', () => {
    expect(formatCompact(0)).toBe('0')
  })

  it('handles negative numbers', () => {
    const result = formatCompact(-1500, 'en-US')
    expect(result).toBe('-1.5K')
  })

  it('limits to 1 decimal place', () => {
    const result = formatCompact(1234, 'en-US')
    expect(result).toBe('1.2K')
  })
})

describe('formatPercentage', () => {
  it('formats percentage with default 1 decimal', () => {
    expect(formatPercentage(45.678)).toBe('45.7%')
    expect(formatPercentage(100)).toBe('100.0%')
    expect(formatPercentage(0)).toBe('0.0%')
  })

  it('formats percentage with custom decimals', () => {
    expect(formatPercentage(45.678, 2)).toBe('45.68%')
    expect(formatPercentage(45.678, 0)).toBe('46%')
  })

  it('handles null and undefined', () => {
    expect(formatPercentage(null)).toBe('0%')
    expect(formatPercentage(undefined)).toBe('0%')
  })

  it('handles NaN values', () => {
    expect(formatPercentage(NaN)).toBe('0%')
  })

  it('handles negative percentages', () => {
    expect(formatPercentage(-10.5)).toBe('-10.5%')
  })

  it('handles percentages over 100', () => {
    expect(formatPercentage(150.25)).toBe('150.3%') // Rounds to 150.3 with 1 decimal
  })
})

describe('formatFileSize', () => {
  it('formats bytes correctly', () => {
    expect(formatFileSize(0)).toBe('0 Bytes')
    expect(formatFileSize(500)).toBe('500 Bytes')
    expect(formatFileSize(1023)).toBe('1023 Bytes')
  })

  it('formats KB correctly', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(2048)).toBe('2 KB')
  })

  it('formats MB correctly', () => {
    expect(formatFileSize(1048576)).toBe('1 MB')
    expect(formatFileSize(1572864)).toBe('1.5 MB')
  })

  it('formats GB correctly', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB')
    expect(formatFileSize(1610612736)).toBe('1.5 GB')
  })

  it('formats TB correctly', () => {
    expect(formatFileSize(1099511627776)).toBe('1 TB')
  })

  it('handles custom decimal places', () => {
    expect(formatFileSize(1536, 0)).toBe('2 KB')
    expect(formatFileSize(1536, 1)).toBe('1.5 KB')
    expect(formatFileSize(1536, 3)).toBe('1.5 KB')
  })

  it('handles null and undefined', () => {
    expect(formatFileSize(null)).toBe('0 Bytes')
    expect(formatFileSize(undefined)).toBe('0 Bytes')
  })

  it('handles NaN values', () => {
    expect(formatFileSize(NaN)).toBe('0 Bytes')
  })

  it('handles negative decimals', () => {
    expect(formatFileSize(1536, -1)).toBe('2 KB')
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => {
    // Mock the current time to 2024-01-01 12:00:00
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats seconds ago', () => {
    const date = new Date('2024-01-01T11:59:30Z')
    expect(formatRelativeTime(date)).toBe('30s ago')
  })

  it('formats minutes ago', () => {
    const date = new Date('2024-01-01T11:55:00Z')
    expect(formatRelativeTime(date)).toBe('5m ago')
  })

  it('formats hours ago', () => {
    const date = new Date('2024-01-01T09:00:00Z')
    expect(formatRelativeTime(date)).toBe('3h ago')
  })

  it('formats days ago', () => {
    const date = new Date('2023-12-29T12:00:00Z')
    expect(formatRelativeTime(date)).toBe('3d ago')
  })

  it('formats months ago', () => {
    const date = new Date('2023-10-01T12:00:00Z')
    expect(formatRelativeTime(date)).toBe('3mo ago')
  })

  it('formats years ago', () => {
    const date = new Date('2022-01-01T12:00:00Z')
    expect(formatRelativeTime(date)).toBe('2y ago')
  })

  it('handles string dates', () => {
    const result = formatRelativeTime('2024-01-01T11:55:00Z')
    expect(result).toBe('5m ago')
  })

  it('handles timestamp numbers', () => {
    const timestamp = new Date('2024-01-01T11:55:00Z').getTime()
    const result = formatRelativeTime(timestamp)
    expect(result).toBe('5m ago')
  })

  it('handles null and undefined', () => {
    expect(formatRelativeTime(null)).toBe('')
    expect(formatRelativeTime(undefined)).toBe('')
  })

  it('handles empty string', () => {
    expect(formatRelativeTime('')).toBe('')
  })

  it('handles just now (0 seconds)', () => {
    const date = new Date('2024-01-01T12:00:00Z')
    expect(formatRelativeTime(date)).toBe('0s ago')
  })
})
