import { describe, it, expect } from 'vitest'
import {
  normalizeRiskLevel,
  scoreToLevel,
  toneToLevel,
  riskFillClass,
  riskTextClass,
  riskTintClass,
  riskRingClass,
  RISK_LEVELS,
  RISK_LABEL,
} from '@/utils/riskTokens'

describe('riskTokens — normalizeRiskLevel', () => {
  it('passes through known levels', () => {
    for (const level of RISK_LEVELS) {
      expect(normalizeRiskLevel(level)).toBe(level)
    }
  })

  it('is case-insensitive', () => {
    expect(normalizeRiskLevel('CRITICAL')).toBe('critical')
  })

  it('falls back to neutral for unknown/missing input', () => {
    expect(normalizeRiskLevel('nonsense')).toBe('neutral')
    expect(normalizeRiskLevel(undefined)).toBe('neutral')
    expect(normalizeRiskLevel(null)).toBe('neutral')
  })
})

describe('riskTokens — scoreToLevel', () => {
  it('maps the 0-5 heuristic score onto low/medium/high/critical', () => {
    expect(scoreToLevel(0)).toBe('low')
    expect(scoreToLevel(1)).toBe('low')
    expect(scoreToLevel(2)).toBe('medium')
    expect(scoreToLevel(3)).toBe('high')
    expect(scoreToLevel(4)).toBe('critical')
    expect(scoreToLevel(5)).toBe('critical')
  })

  it('clamps out-of-range scores', () => {
    expect(scoreToLevel(-3)).toBe('low')
    expect(scoreToLevel(99)).toBe('critical')
  })

  it('returns neutral for non-numeric input', () => {
    expect(scoreToLevel(undefined)).toBe('neutral')
    expect(scoreToLevel(NaN)).toBe('neutral')
    expect(scoreToLevel('3')).toBe('neutral')
  })
})

describe('riskTokens — toneToLevel', () => {
  it('maps PRRiskBadges tones onto the shared severity scale', () => {
    expect(toneToLevel('danger')).toBe('critical')
    expect(toneToLevel('warning')).toBe('high')
    expect(toneToLevel('info')).toBe('medium')
    expect(toneToLevel('neutral')).toBe('neutral')
    expect(toneToLevel('unknown-tone')).toBe('neutral')
  })
})

describe('riskTokens — class name generators', () => {
  it('produce ds-risk-* class names keyed by the normalized level', () => {
    expect(riskFillClass('high')).toBe('ds-risk-fill-high')
    expect(riskTextClass('critical')).toBe('ds-risk-text-critical')
    expect(riskTintClass('low')).toBe('ds-risk-tint-low')
    expect(riskRingClass('medium')).toBe('ds-risk-ring-medium')
  })

  it('normalize unknown input to the neutral class', () => {
    expect(riskFillClass('made-up')).toBe('ds-risk-fill-neutral')
  })

  it('has a label for every level plus neutral', () => {
    for (const level of [...RISK_LEVELS, 'neutral']) {
      expect(RISK_LABEL[level]).toBeTruthy()
    }
  })
})
