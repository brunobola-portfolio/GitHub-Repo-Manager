// Tests for the per-feature AI metering helpers added in the 2026-04-15
// free-tier expansion.
//
// Covers:
// - checkAIFeatureLimit picks the right metric to name in the error
//   (per-feature cap wins when it's the one exceeded; global ai_queries
//   cap wins when the per-feature is allowed but the global is not).
// - incrementAIUsage bumps both the feature counter AND the global counter
//   in a single transaction.
// - quotaExceededResponse returns the documented shape.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db module with in-memory counters so we can assert on writes
// without a real sqlite file.
vi.mock('../db.js', () => {
    const counters = new Map() // `${userId}|${metric}` -> number
    const transactionFn = (fn) => (...args) => fn(...args)
    const prepareFn = vi.fn((sql) => {
        if (sql.includes('INSERT INTO usage_metrics')) {
            return {
                run: (userId, metric /* count, start, end */) => {
                    const key = `${userId}|${metric}`
                    counters.set(key, (counters.get(key) || 0) + 1)
                },
            }
        }
        if (sql.includes('SELECT count FROM usage_metrics')) {
            return {
                get: (userId, metric) => {
                    const c = counters.get(`${userId}|${metric}`)
                    return c === undefined ? undefined : { count: c }
                },
            }
        }
        return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) }
    })
    return {
        default: {
            prepare: prepareFn,
            transaction: transactionFn,
            __counters: counters,
        },
    }
})

vi.mock('../middleware/require-tier.js', () => ({
    getUserTier: vi.fn(() => 'free'),
}))

vi.mock('../lib/feature-flags.js', () => ({
    getFeatures: vi.fn(() => ({
        aiQueriesPerMonth: 200,
        readmeGenPerMonth: 5,
        commitGenPerMonth: 50,
        repoInsightsPerMonth: 15,
        migrationRiskPerMonth: 5,
        semanticSearchPerMonth: 75,
        maxRepos: 50,
    })),
}))

describe('usage-meter — AI feature helpers', () => {
    beforeEach(async () => {
        const { default: db } = await import('../db.js')
        db.__counters.clear()
        vi.clearAllMocks()
    })

    it('incrementAIUsage bumps feature + global ai_queries together', async () => {
        const { default: db } = await import('../db.js')
        const { incrementAIUsage, getCurrentUsage } = await import('../lib/usage-meter.js')

        incrementAIUsage(1, 'ai_readme')

        expect(getCurrentUsage(1, 'ai_readme')).toBe(1)
        expect(getCurrentUsage(1, 'ai_queries')).toBe(1)
        // Separate user is unaffected
        expect(getCurrentUsage(2, 'ai_readme')).toBe(0)
        void db // silence unused
    })

    it('incrementAIUsage with featureMetric=ai_queries only bumps global counter once', async () => {
        const { incrementAIUsage, getCurrentUsage } = await import('../lib/usage-meter.js')

        incrementAIUsage(1, 'ai_queries')

        expect(getCurrentUsage(1, 'ai_queries')).toBe(1)
    })

    it('checkAIFeatureLimit names the per-feature metric when its cap is exceeded', async () => {
        const { incrementAIUsage, checkAIFeatureLimit } = await import('../lib/usage-meter.js')

        // Exhaust the per-feature cap (readme=5) but global (200) still has room
        for (let i = 0; i < 5; i++) incrementAIUsage(1, 'ai_readme')

        const result = checkAIFeatureLimit(1, 'ai_readme')
        expect(result.allowed).toBe(false)
        expect(result.metric).toBe('ai_readme')
        expect(result.current).toBe(5)
        expect(result.limit).toBe(5)
    })

    it('checkAIFeatureLimit names ai_queries when the global cap is exceeded first', async () => {
        const { incrementUsage, checkAIFeatureLimit } = await import('../lib/usage-meter.js')

        // Push global ai_queries over the 200 cap without exhausting ai_commit (50)
        for (let i = 0; i < 200; i++) incrementUsage(1, 'ai_queries')

        const result = checkAIFeatureLimit(1, 'ai_commit')
        expect(result.allowed).toBe(false)
        expect(result.metric).toBe('ai_queries')
        expect(result.limit).toBe(200)
    })

    it('checkAIFeatureLimit returns allowed:true when both caps have room', async () => {
        const { checkAIFeatureLimit } = await import('../lib/usage-meter.js')

        const result = checkAIFeatureLimit(1, 'ai_commit')
        expect(result.allowed).toBe(true)
        expect(result.metric).toBe('ai_commit')
    })

    it('quotaExceededResponse labels per-feature metrics with a friendly name', async () => {
        const { quotaExceededResponse } = await import('../lib/usage-meter.js')

        const body = quotaExceededResponse({
            allowed: false, current: 5, limit: 5, remaining: 0, metric: 'ai_readme',
        })

        expect(body.error).toBe('usage_limit_exceeded')
        expect(body.message).toMatch(/README Generator/)
        expect(body.metric).toBe('ai_readme')
        expect(body.limit).toBe(5)
        expect(body.current).toBe(5)
        expect(body.upgradeUrl).toBe('/pricing')
    })

    it('quotaExceededResponse labels ai_queries metric as generic AI queries', async () => {
        const { quotaExceededResponse } = await import('../lib/usage-meter.js')

        const body = quotaExceededResponse({
            allowed: false, current: 200, limit: 200, remaining: 0, metric: 'ai_queries',
        })

        expect(body.message).toMatch(/AI query limit/i)
        expect(body.metric).toBe('ai_queries')
    })
})
