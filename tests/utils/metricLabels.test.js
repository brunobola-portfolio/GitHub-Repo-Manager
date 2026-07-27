import { describe, it, expect } from 'vitest'
import { metricLabel, METRIC_LABELS } from '../../src/utils/metricLabels'

describe('metricLabel', () => {
  it('names the metric the way the product does', () => {
    expect(metricLabel('ai_deep_review')).toBe('AI Deep Review')
    expect(metricLabel('ai_pr_chat')).toBe('PR chat message')
    expect(metricLabel('sync_apply_executions')).toBe('mirror sync apply')
  })

  it('never renders a raw snake_case key', () => {
    // The whole point: "You've used your monthly ai_deep_review allowance"
    // showed a code identifier where the product name belonged.
    for (const key of Object.keys(METRIC_LABELS)) {
      expect(metricLabel(key)).not.toMatch(/_/)
    }
  })

  it('de-slugs an unknown metric rather than leaking the key', () => {
    expect(metricLabel('ai_brand_new_thing')).toBe('Ai Brand New Thing')
  })

  it('leaves an already-human label untouched', () => {
    // Some callers pass display text straight through; title-casing it would
    // mangle "AI queries" into "AI Queries".
    expect(metricLabel('AI queries')).toBe('AI queries')
    expect(metricLabel('Deep Review')).toBe('Deep Review')
  })

  it('falls back for a missing or non-string metric', () => {
    expect(metricLabel(undefined)).toBe('AI request')
    expect(metricLabel(null)).toBe('AI request')
    expect(metricLabel({})).toBe('AI request')
  })
})
