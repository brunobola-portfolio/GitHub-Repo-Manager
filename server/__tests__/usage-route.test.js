// @vitest-environment node
/**
 * GET /api/v1/usage — B1 (UTC period key) + B2 (10 previously-invisible quotas).
 *
 * B1: the route used to build period_start from LOCAL calendar fields
 * (`now.getFullYear()/getMonth()`) while every write path
 * (usage-meter.js getCurrentPeriod()) buckets in UTC. On a host east of UTC
 * near a month boundary the read key and write key diverge and the Settings
 * → Usage panel reads 0 forever. The fix reuses getCurrentPeriod() for the
 * read, same as every write.
 *
 * B2: the route only ever surfaced 5 of the ~15 enforced per-feature AI/
 * migration/sync quotas. This locks the other 10 (ai_deep_review, ai_pr_chat,
 * ai_pr_command, ai_prompt_test, ai_diagram, ai_agent_rules,
 * ai_security_posture, ai_image, migration_full_executions,
 * sync_apply_executions) into the response shape, resolved via the real
 * feature-flags.js (so the numbers are never a second, drifting copy).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { getCurrentPeriod } from '../lib/usage-meter.js'

const mockPrepare = vi.fn()
vi.mock('../db.js', () => ({
    default: {
        prepare: (...a) => mockPrepare(...a),
        // usage-meter.js builds a couple of db.transaction()-wrapped helpers
        // at module scope (incrementAIUsageTxn etc.) — needed even though this
        // suite only exercises the read path, since importing getCurrentPeriod
        // pulls in the whole module.
        transaction: (fn) => (...args) => fn(...args),
    },
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => { req.session = { userId: 7 }; next() },
}))

const mockGetUserTier = vi.fn(() => 'free')
vi.mock('../middleware/require-tier.js', () => ({
    getUserTier: (...a) => mockGetUserTier(...a),
}))

const { default: usageRouter } = await import('../routes/usage.js')

function makeApp() {
    const app = express()
    app.use('/api/v1/usage', usageRouter)
    return app
}

function mockDbWith(rows, apiKeyCount = 0) {
    let capturedPeriodStart = null
    mockPrepare.mockImplementation((sql) => {
        if (/SELECT metric_type, count FROM usage_metrics/.test(sql)) {
            return {
                all: vi.fn((_userId, periodStart) => {
                    capturedPeriodStart = periodStart
                    return rows
                }),
            }
        }
        if (/SELECT COUNT\(\*\) as n FROM api_keys/.test(sql)) {
            return { get: vi.fn(() => ({ n: apiKeyCount })) }
        }
        return { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() }
    })
    return { getCapturedPeriodStart: () => capturedPeriodStart }
}

describe('GET /api/v1/usage', () => {
    const ORIGINAL_TZ = process.env.TZ

    beforeEach(() => {
        mockPrepare.mockReset()
        mockGetUserTier.mockReset()
        mockGetUserTier.mockReturnValue('free')
    })

    afterEach(() => {
        process.env.TZ = ORIGINAL_TZ
        vi.useRealTimers()
    })

    // -----------------------------------------------------------------
    // B1 — UTC period key regression
    // -----------------------------------------------------------------
    it('B1: reads with the SAME UTC period_start the write path (getCurrentPeriod) uses, on a host far ahead of UTC', async () => {
        // UTC+14 — the furthest-ahead real IANA zone, so any UTC/local
        // divergence is maximised.
        process.env.TZ = 'Pacific/Kiritimati'
        // 2026-02-28T23:00:00Z is still February in UTC, but already March 1
        // local in UTC+14 — the exact boundary where a local-time period key
        // (the pre-fix bug) diverges from the UTC one every write uses.
        const fixedInstant = new Date('2026-02-28T23:00:00.000Z')
        vi.useFakeTimers()
        vi.setSystemTime(fixedInstant)

        const expectedPeriodStart = getCurrentPeriod(fixedInstant).start
        const buggyLocalPeriodStart = new Date(
            fixedInstant.getFullYear(), fixedInstant.getMonth(), 1
        ).toISOString()
        // Sanity check that this environment/instant combination actually
        // exercises the bug (local calendar month really does differ from UTC).
        expect(buggyLocalPeriodStart).not.toBe(expectedPeriodStart)

        const { getCapturedPeriodStart } = mockDbWith([])

        const res = await request(makeApp()).get('/api/v1/usage')

        expect(res.status).toBe(200)
        expect(res.body.period_start).toBe(expectedPeriodStart)
        // The SELECT against usage_metrics was queried with the same key —
        // i.e. the read key matches every write's period_start.
        expect(getCapturedPeriodStart()).toBe(expectedPeriodStart)
    })

    it('B1: read key stays UTC-aligned across the December -> next-year rollover regardless of host TZ', async () => {
        process.env.TZ = 'Pacific/Kiritimati'
        const fixedInstant = new Date('2026-12-31T23:30:00.000Z')
        vi.useFakeTimers()
        vi.setSystemTime(fixedInstant)

        const expectedPeriodStart = getCurrentPeriod(fixedInstant).start
        mockDbWith([])

        const res = await request(makeApp()).get('/api/v1/usage')
        expect(res.body.period_start).toBe(expectedPeriodStart)
    })

    // -----------------------------------------------------------------
    // B2 — surfaces the 10 previously-invisible quotas
    // -----------------------------------------------------------------
    it('B2: surfaces all 10 previously-invisible metrics with real Free-tier limits from feature-flags.js', async () => {
        mockGetUserTier.mockReturnValue('free')
        mockDbWith([
            { metric_type: 'ai_deep_review', count: 3 },
            { metric_type: 'ai_pr_chat', count: 12 },
            { metric_type: 'ai_pr_command', count: 1 },
            { metric_type: 'ai_prompt_test', count: 30 },
            { metric_type: 'ai_diagram', count: 2 },
            { metric_type: 'ai_agent_rules', count: 4 },
            { metric_type: 'ai_security_posture', count: 5 },
            { metric_type: 'ai_image', count: 1 },
            { metric_type: 'migration_full_executions', count: 2 },
            { metric_type: 'sync_apply_executions', count: 6 },
        ])

        const res = await request(makeApp()).get('/api/v1/usage')
        expect(res.status).toBe(200)

        // Free-tier limits pinned in server/lib/feature-flags.js — read from
        // there via METRIC_TO_FEATURE, never duplicated here as literals for
        // the assertion's own sake beyond confirming the wiring is correct.
        expect(res.body.aiFeatures.deepReview).toEqual({ current: 3, limit: 10 })
        expect(res.body.aiFeatures.prChat).toEqual({ current: 12, limit: 100 })
        expect(res.body.aiFeatures.prCommand).toEqual({ current: 1, limit: 30 })
        expect(res.body.aiFeatures.promptTest).toEqual({ current: 30, limit: 30 })
        expect(res.body.aiFeatures.diagram).toEqual({ current: 2, limit: 15 })
        expect(res.body.aiFeatures.agentRules).toEqual({ current: 4, limit: 20 })
        expect(res.body.aiFeatures.securityPosture).toEqual({ current: 5, limit: 75 })
        expect(res.body.aiFeatures.image).toEqual({ current: 1, limit: 5 })
        expect(res.body.migrationAndSync.migrationFull).toEqual({ current: 2, limit: 5 })
        expect(res.body.migrationAndSync.syncApply).toEqual({ current: 6, limit: 10 })

        // Pre-existing 5 rows still present (no regression).
        expect(res.body.aiFeatures.readme).toBeDefined()
        expect(res.body.aiFeatures.commit).toBeDefined()
        expect(res.body.aiFeatures.insights).toBeDefined()
        expect(res.body.aiFeatures.migrationRisk).toBeDefined()
        expect(res.body.aiFeatures.semanticSearch).toBeDefined()
    })

    it('B2: renders Unlimited (JSON null, not NaN) for the new metrics on Pro/Enterprise', async () => {
        mockGetUserTier.mockReturnValue('enterprise')
        mockDbWith([{ metric_type: 'ai_deep_review', count: 40 }])

        const res = await request(makeApp()).get('/api/v1/usage')
        // Infinity serialises to null over JSON — the frontend's isInf/
        // formatLimit already treat that as Unlimited; this pins the
        // contract so a future refactor can't silently emit NaN instead.
        expect(res.body.aiFeatures.deepReview).toEqual({ current: 40, limit: null })
        expect(res.body.aiFeatures.image.limit).toBeNull()
        expect(res.body.migrationAndSync.migrationFull.limit).toBeNull()
        expect(JSON.stringify(res.body)).not.toMatch(/NaN/)
    })

    it('metrics absent from usage_metrics default to current: 0', async () => {
        mockGetUserTier.mockReturnValue('free')
        mockDbWith([])
        const res = await request(makeApp()).get('/api/v1/usage')
        expect(res.body.aiFeatures.agentRules).toEqual({ current: 0, limit: 20 })
        expect(res.body.migrationAndSync.syncApply).toEqual({ current: 0, limit: 10 })
    })
})
