// @vitest-environment node
/**
 * Monthly AI spend-cap coverage for the indexing/search surface — mirrors
 * ai-guarded-generate.test.js's cap-reached / cap-ok assertions, but at the
 * route level for the endpoints that call the AI provider outside
 * guardedGenerate(): POST /ai/index, POST /ai/batch-index, and the
 * semanticSearch->embedText path of GET /ai/search (see docs/reports/
 * 2026-07-17-code-ui-ux-audit-panel.md, FIX-1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockCheckUsageLimit = vi.fn()
const mockCheckAIFeatureLimit = vi.fn()
const mockGuardedIncrementAIUsage = vi.fn()
const mockReleaseGuardedAIUsage = vi.fn()
const mockIncrementAIUsage = vi.fn()
vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: (...args) => mockCheckUsageLimit(...args),
    checkAIFeatureLimit: (...args) => mockCheckAIFeatureLimit(...args),
    incrementAIUsage: (...args) => mockIncrementAIUsage(...args),
    guardedIncrementAIUsage: (...args) => mockGuardedIncrementAIUsage(...args),
    releaseGuardedAIUsage: (...args) => mockReleaseGuardedAIUsage(...args),
    quotaExceededResponse: (check) => ({
        error: 'usage_limit_exceeded',
        code: 'QUOTA_EXCEEDED',
        metric: check.metric,
        limit: check.limit,
        current: check.current,
        upgradeUrl: '/pricing',
    }),
}))

const mockCheckAISpendCap = vi.fn()
const mockRecordAISpend = vi.fn()
vi.mock('../lib/ai-spend-cap.js', () => ({
    checkAISpendCap: (...args) => mockCheckAISpendCap(...args),
    recordAISpend: (...args) => mockRecordAISpend(...args),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
        next()
    },
    createRequireAI: () => (req, res, next) => next(),
    safeError: (err, fallback) => err?.message || fallback,
}))

vi.mock('../ai-service.js', () => ({
    aiService: {
        model: {},
        analyzeRepo: vi.fn(),
        embedText: vi.fn(),
        semanticSearch: vi.fn(),
        findSimilarById: vi.fn(),
    },
    sanitizeForPrompt: (s) => s,
}))

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn().mockRejectedValue({ status: 404 }) }))

vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({
            get: vi.fn(() => null),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 1, lastInsertRowid: 99 })),
        })),
        transaction: vi.fn((fn) => fn),
    },
}))

vi.mock('../middleware/validate-request.js', () => ({
    validateBody: () => (req, _res, next) => { req.validatedBody = req.body; next() },
    validateQuery: () => (req, _res, next) => { req.validatedQuery = req.query; next() },
    validateParams: () => (req, _res, next) => { req.validatedParams = req.params; next() },
}))

function makeSession(overrides = {}) {
    return { accessToken: 'tok', userId: 42, ...overrides }
}

async function buildApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = makeSession()
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
        next()
    })
    const { default: aiRouter } = await import('../routes/ai.js')
    app.use('/api', aiRouter)
    return app
}

const ALLOWED_RESERVE = { allowed: true, metric: 'ai_insights', current: 1, limit: 100, remaining: 99 }
const ALLOWED_SPEND = { allowed: true, capCents: 0, spentCents: 0 }
const DENIED_SPEND = { allowed: false, capCents: 500, spentCents: 500 }
const ALLOWED_FEATURE = { allowed: true, metric: 'ai_semantic_search', current: 1, limit: 50, remaining: 49 }

beforeEach(() => {
    vi.clearAllMocks()
    mockGuardedIncrementAIUsage.mockReturnValue(ALLOWED_RESERVE)
    mockCheckAIFeatureLimit.mockReturnValue(ALLOWED_FEATURE)
    mockCheckUsageLimit.mockReturnValue({ allowed: true, current: 0, limit: 200, remaining: 200 })
    mockCheckAISpendCap.mockReturnValue(ALLOWED_SPEND)
})

describe('POST /api/ai/index — monthly spend cap', () => {
    it('returns 429 AI_SPEND_CAP_REACHED and never calls the provider when over cap', async () => {
        mockCheckAISpendCap.mockReturnValue(DENIED_SPEND)
        const { aiService } = await import('../ai-service.js')
        const app = await buildApp()

        const res = await request(app)
            .post('/api/ai/index')
            .send({ repo: { id: 1, full_name: 'o/r', name: 'r' } })

        expect(res.status).toBe(429)
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED')
        expect(aiService.analyzeRepo).not.toHaveBeenCalled()
        // The usage reservation taken before the spend-cap check must be
        // released, not silently burned, when the request is denied.
        expect(mockReleaseGuardedAIUsage).toHaveBeenCalledWith(42, 'ai_insights')
    })

    it('reserves usage atomically BEFORE the provider call, and records spend after success', async () => {
        const { aiService } = await import('../ai-service.js')
        aiService.analyzeRepo.mockResolvedValue({
            summary: 's', suggested_topics: [], health_score: 80, _costUSD: 0.02,
        })
        aiService.embedText.mockResolvedValue([0.1, 0.2])
        const app = await buildApp()

        const res = await request(app)
            .post('/api/ai/index')
            .send({ repo: { id: 1, full_name: 'o/r', name: 'r' } })

        expect(res.status).toBe(200)
        expect(mockGuardedIncrementAIUsage).toHaveBeenCalledWith(42, 'ai_insights')
        expect(mockCheckAISpendCap).toHaveBeenCalledWith(42)
        expect(mockRecordAISpend).toHaveBeenCalledWith(42, 0.02)
        // Reservation succeeded and the call succeeded — no release.
        expect(mockReleaseGuardedAIUsage).not.toHaveBeenCalled()
    })

    it('returns 429 when the guarded reservation itself denies (quota exhausted)', async () => {
        mockGuardedIncrementAIUsage.mockReturnValue({ allowed: false, metric: 'ai_insights', current: 100, limit: 100, remaining: 0 })
        const { aiService } = await import('../ai-service.js')
        const app = await buildApp()

        const res = await request(app)
            .post('/api/ai/index')
            .send({ repo: { id: 1, full_name: 'o/r', name: 'r' } })

        expect(res.status).toBe(429)
        expect(aiService.analyzeRepo).not.toHaveBeenCalled()
        expect(mockCheckAISpendCap).not.toHaveBeenCalled()
    })

    it('releases the reservation when the provider call fails after a successful reserve', async () => {
        const { aiService } = await import('../ai-service.js')
        aiService.analyzeRepo.mockRejectedValue(new Error('provider exploded'))
        const app = await buildApp()

        const res = await request(app)
            .post('/api/ai/index')
            .send({ repo: { id: 1, full_name: 'o/r', name: 'r' } })

        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(mockReleaseGuardedAIUsage).toHaveBeenCalledWith(42, 'ai_insights')
    })
})

describe('GET /api/ai/search — monthly spend cap (semanticSearch->embedText path)', () => {
    it('returns 429 AI_SPEND_CAP_REACHED and never calls semanticSearch when over cap', async () => {
        mockCheckAISpendCap.mockReturnValue(DENIED_SPEND)
        const { aiService } = await import('../ai-service.js')
        const app = await buildApp()

        const res = await request(app).get('/api/ai/search?q=react')

        expect(res.status).toBe(429)
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED')
        expect(aiService.semanticSearch).not.toHaveBeenCalled()
    })

    it('proceeds to semanticSearch when under the cap', async () => {
        const { aiService } = await import('../ai-service.js')
        aiService.semanticSearch.mockResolvedValue([])
        const app = await buildApp()

        const res = await request(app).get('/api/ai/search?q=react')

        expect(res.status).toBe(200)
        expect(aiService.semanticSearch).toHaveBeenCalled()
    })

    it('does NOT spend-cap-gate the pure DB similar-by-id lookup', async () => {
        mockCheckAISpendCap.mockReturnValue(DENIED_SPEND)
        const { aiService } = await import('../ai-service.js')
        aiService.findSimilarById.mockResolvedValue([{ repoId: 2, score: 0.9 }])
        const app = await buildApp()

        const res = await request(app).get('/api/ai/search?mode=similar-by-id&repoId=1')

        expect(res.status).toBe(200)
        expect(aiService.findSimilarById).toHaveBeenCalled()
    })
})

describe('POST /api/ai/batch-index — monthly spend cap stops mid-batch', () => {
    it('stops processing further repos once the spend cap is reached, but keeps already-analyzed ones', async () => {
        const { aiService } = await import('../ai-service.js')
        aiService.analyzeRepo.mockResolvedValue({ summary: 's', suggested_topics: [], health_score: 80, _costUSD: 0.01 })
        aiService.embedText.mockResolvedValue([0.1])
        mockCheckUsageLimit.mockReturnValue({ allowed: true, current: 0, limit: 200, remaining: 200 })
        // Allowed for the first repo, denied from the second call onward.
        mockCheckAISpendCap
            .mockReturnValueOnce(ALLOWED_SPEND)
            .mockReturnValue(DENIED_SPEND)
        const app = await buildApp()

        const repos = [
            { id: 1, full_name: 'o/r1', name: 'r1' },
            { id: 2, full_name: 'o/r2', name: 'r2' },
            { id: 3, full_name: 'o/r3', name: 'r3' },
        ]
        const res = await request(app).post('/api/ai/batch-index').send({ repos })

        expect(res.status).toBe(200)
        expect(aiService.analyzeRepo).toHaveBeenCalledTimes(1)
        expect(res.body.processed).toBe(1)
        expect(res.body.skipped).toBe(2)
    })

    it('records spend per successfully analyzed item', async () => {
        const { aiService } = await import('../ai-service.js')
        aiService.analyzeRepo
            .mockResolvedValueOnce({ summary: 's', suggested_topics: [], health_score: 1, _costUSD: 0.01 })
            .mockResolvedValueOnce({ summary: 's', suggested_topics: [], health_score: 2, _costUSD: 0.03 })
        aiService.embedText.mockResolvedValue([0.1])
        mockCheckUsageLimit.mockReturnValue({ allowed: true, current: 0, limit: 200, remaining: 200 })
        mockCheckAISpendCap.mockReturnValue(ALLOWED_SPEND)
        const app = await buildApp()

        const repos = [
            { id: 1, full_name: 'o/r1', name: 'r1' },
            { id: 2, full_name: 'o/r2', name: 'r2' },
        ]
        const res = await request(app).post('/api/ai/batch-index').send({ repos })

        expect(res.status).toBe(200)
        expect(mockRecordAISpend).toHaveBeenCalledWith(42, 0.01)
        expect(mockRecordAISpend).toHaveBeenCalledWith(42, 0.03)
    })
})
