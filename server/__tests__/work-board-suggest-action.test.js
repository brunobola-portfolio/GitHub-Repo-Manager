// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockProvider = { generate: vi.fn() }

vi.mock('../lib/ai-provider.js', () => ({
    createProviderForUser: vi.fn().mockResolvedValue(mockProvider),
}))

vi.mock('../db.js', async () => {
    const Database = (await import('better-sqlite3')).default
    const { initDB } = await vi.importActual('../db.js')
    const db = new Database(':memory:')
    initDB(db)
    db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(1, 'alice')
    return { default: db, initDB: () => {} }
})

vi.mock('../lib/work-board-cache.js', () => ({
    getCacheRow: vi.fn(() => null),
    putCacheRow: vi.fn(),
    getCached: vi.fn(() => null),
    putCached: vi.fn(),
    invalidate: vi.fn(),
    purgeExpired: vi.fn(),
}))

vi.mock('../lib/event-aggregations.js', () => ({
    listMyPendingReviews: vi.fn(() => []),
    listStalePRs: vi.fn(() => []),
    listMyOpenIssues: vi.fn(() => []),
    deployFrequency: vi.fn(() => ({ totalDeployments: 0, perDay: [] })),
    leadTimeForChanges: vi.fn(() => ({ sampleSize: 0, p50: null, p90: null })),
    reviewLoadByReviewer: vi.fn(() => []),
    changeFailureRate: vi.fn(() => ({ total: 0, failed: 0, rate: null })),
    meanTimeToRecovery: vi.fn(() => ({ sampleSize: 0, p50: null, p90: null, unresolved: 0 })),
    listTechDebtIssues: vi.fn(() => []),
    techDebtHotspots: vi.fn(() => []),
}))

vi.mock('../lib/work-board-kpi-snapshots.js', () => ({
    getSnapshots: vi.fn(() => []),
    writeSnapshot: vi.fn(() => ({ inserted: false })),
    pruneSnapshots: vi.fn(() => 0),
}))

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => {
        req.session = { userId: 1, userLogin: 'alice', accessToken: 'tok' }
        next()
    },
    errorResponse: (res, status, message, code) => res.status(status).json({ error: message, code }),
    safeError: (_err, fallback) => fallback,
    validateBody: (schema) => (req, res, next) => {
        const result = schema.safeParse(req.body)
        if (!result.success) return res.status(400).json({ error: 'Validation failed' })
        req.validatedBody = result.data
        next()
    },
}))

vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_req, _res, next) => next(),
}))

// checkUsageLimit/incrementUsage are overridden per-test for deterministic
// quota control; quotaExceededResponse stays real so tests pin the exact
// envelope shape the frontend's <QuotaExceededState /> expects.
const mockCheckUsageLimit = vi.fn(() => ({ allowed: true, current: 0, limit: 200, remaining: 200 }))
const mockIncrementUsage = vi.fn()
vi.mock('../lib/usage-meter.js', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        checkUsageLimit: (...args) => mockCheckUsageLimit(...args),
        incrementUsage: (...args) => mockIncrementUsage(...args),
    }
})

// Monthly AI spend cap (OWASP LLM10) — controllable per test, independent of
// the ai_queries count quota above.
const mockCheckAISpendCap = vi.fn(() => ({ allowed: true, capCents: 0, spentCents: 0 }))
const mockRecordAISpend = vi.fn()
vi.mock('../lib/ai-spend-cap.js', () => ({
    checkAISpendCap: (...args) => mockCheckAISpendCap(...args),
    recordAISpend: (...args) => mockRecordAISpend(...args),
}))

const { default: workBoardActionsRouter, _resetSuggestActionRateLimit } = await import('../routes/work-board-actions.js')

const app = express()
app.use(express.json())
app.use('/api/v1/work-board', workBoardActionsRouter)

const VALID_BODY = {
    repoFullName: 'acme/api',
    itemType: 'pr',
    itemNumber: 42,
    title: 'Fix null ref in auth',
    ageDays: 10,
    authorLogin: 'bob',
}

describe('POST /api/v1/work-board/suggest-action', () => {
    beforeAll(() => {
        mockProvider.generate.mockResolvedValue({
            parsed: { pingComment: 'Hey @bob, any update on this PR?' },
        })
    })

    beforeEach(() => {
        mockCheckUsageLimit.mockReturnValue({ allowed: true, current: 0, limit: 200, remaining: 200 })
        mockIncrementUsage.mockClear()
        mockCheckAISpendCap.mockReturnValue({ allowed: true, capCents: 0, spentCents: 0 })
        mockRecordAISpend.mockClear()
        _resetSuggestActionRateLimit(1)
    })

    it('returns 3 suggestions on success', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send(VALID_BODY)
        expect(res.status).toBe(200)
        expect(res.body.suggestions).toHaveLength(3)
        const actions = res.body.suggestions.map(s => s.action)
        expect(actions).toContain('comment')
        expect(actions).toContain('snooze')
        expect(actions).toContain('open')
    })

    it('includes AI-drafted ping comment body', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send(VALID_BODY)
        const ping = res.body.suggestions.find(s => s.action === 'comment')
        expect(ping.body).toContain('@bob')
    })

    it('returns 403 when no AI provider configured', async () => {
        const { createProviderForUser } = await import('../lib/ai-provider.js')
        vi.mocked(createProviderForUser).mockResolvedValueOnce(null)
        const res = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send(VALID_BODY)
        expect(res.status).toBe(403)
    })

    it('returns 400 for invalid body', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send({ repoFullName: 'bad' })
        expect(res.status).toBe(400)
    })

    it('increments ai_queries usage on a successful suggestion generation', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send(VALID_BODY)
        expect(res.status).toBe(200)
        expect(mockIncrementUsage).toHaveBeenCalledWith(1, 'ai_queries')
    })

    it('does NOT charge ai_queries when provider.generate rejects (200 fallback ping)', async () => {
        mockProvider.generate.mockRejectedValueOnce(new Error('provider outage'))
        const res = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send(VALID_BODY)
        // Route degrades to the canned ping — still 200 with 3 suggestions —
        // but a failed LLM attempt must not debit the monthly quota (charge
        // on provider success only, matching every metered sibling).
        expect(res.status).toBe(200)
        expect(res.body.suggestions).toHaveLength(3)
        const ping = res.body.suggestions.find(s => s.action === 'comment')
        expect(ping.body).toBe('Hey @bob, any update on this?')
        expect(mockIncrementUsage).not.toHaveBeenCalled()
    })

    it('returns 429 QUOTA_EXCEEDED when the ai_queries quota is exhausted, without calling the provider', async () => {
        mockCheckUsageLimit.mockReturnValue({ allowed: false, current: 200, limit: 200, remaining: 0 })
        const { createProviderForUser } = await import('../lib/ai-provider.js')
        vi.mocked(createProviderForUser).mockClear()
        const res = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send(VALID_BODY)
        expect(res.status).toBe(429)
        expect(res.body.code).toBe('QUOTA_EXCEEDED')
        expect(res.body.upgradeUrl).toBe('/pricing')
        expect(createProviderForUser).not.toHaveBeenCalled()
    })

    it('returns the canonical 429 AI_SPEND_CAP_REACHED envelope and never resolves a provider when over the monthly cap', async () => {
        mockCheckAISpendCap.mockReturnValue({ allowed: false, capCents: 100, spentCents: 150 })
        const { createProviderForUser } = await import('../lib/ai-provider.js')
        vi.mocked(createProviderForUser).mockClear()
        const res = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send(VALID_BODY)
        expect(res.status).toBe(429)
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED')
        expect(createProviderForUser).not.toHaveBeenCalled()
    })

    it('records spend on a successful AI-drafted ping', async () => {
        mockProvider.generate.mockResolvedValueOnce({ parsed: { pingComment: 'Hey @bob, any update?' }, costUSD: 0.01 })
        const res = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send(VALID_BODY)
        expect(res.status).toBe(200)
        expect(mockRecordAISpend).toHaveBeenCalledWith(1, 0.01)
    })

    it('returns 429 rate_limited after 10 requests in an hour, keyed per user', async () => {
        for (let i = 0; i < 10; i++) {
            const ok = await request(app)
                .post('/api/v1/work-board/suggest-action')
                .send(VALID_BODY)
            expect(ok.status).toBe(200)
        }
        const overflow = await request(app)
            .post('/api/v1/work-board/suggest-action')
            .send(VALID_BODY)
        expect(overflow.status).toBe(429)
        expect(overflow.body.code).toBe('rate_limited')
    })
})
