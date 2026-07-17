import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockGenerate = vi.fn()

vi.mock('../ai-service.js', () => ({
    aiService: { model: {}, genAI: { getGenerativeModel: () => ({}) } },
    sanitizeForPrompt: (s) => s,
}))

vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js')
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
            next()
        },
        createRequireAI: () => (req, res, next) => {
            req.aiProvider = {
                modelId: 'gemini-test',
                generate: (...args) => mockGenerate(...args),
            }
            next()
        },
    }
})

const checkUsageLimit = vi.fn(() => ({ allowed: true, current: 0, limit: 100, remaining: 100 }))
const incrementUsage = vi.fn()
vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: (...a) => checkUsageLimit(...a),
    incrementUsage: (...a) => incrementUsage(...a),
    checkAIFeatureLimit: vi.fn(() => ({ allowed: true })),
    incrementAIUsage: vi.fn(),
    quotaExceededResponse: (check) => ({ error: 'usage_limit_exceeded', limit: check.limit, current: check.current }),
}))

vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({ get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn(() => ({ changes: 1 })) })),
        transaction: (fn) => fn,
    },
}))

const checkAISpendCap = vi.fn(() => ({ allowed: true, capCents: 0, spentCents: 0 }))
const recordAISpend = vi.fn()
vi.mock('../lib/ai-spend-cap.js', () => ({
    checkAISpendCap: (...a) => checkAISpendCap(...a),
    recordAISpend: (...a) => recordAISpend(...a),
}))

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn(() => Promise.resolve({ data: {} })) }))

const { clearTranslateSearchCache } = await import('../lib/translate-search.js')

async function buildApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'tok', userId: 1, user: { id: 1, login: 'alice' } }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    const { default: aiRouter } = await import('../routes/ai.js')
    app.use('/api', aiRouter)
    return app
}

describe('POST /api/ai/translate-search', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        clearTranslateSearchCache()
        checkUsageLimit.mockImplementation(() => ({ allowed: true, current: 0, limit: 100, remaining: 100 }))
        checkAISpendCap.mockImplementation(() => ({ allowed: true, capCents: 0, spentCents: 0 }))
    })

    it('returns the translated payload on first call', async () => {
        mockGenerate.mockResolvedValue({
            text: JSON.stringify({
                summary: 'PRs you need to review',
                queries: [{ type: 'pr', ghQuery: 'is:pr review-requested:@me' }],
            }),
        })
        const res = await request(await buildApp())
            .post('/api/ai/translate-search')
            .send({ q: 'PRs I need to review' })
        expect(res.status).toBe(200)
        expect(res.body.cached).toBe(false)
        expect(res.body.queries).toHaveLength(1)
        expect(res.body.queries[0].ghQuery).toContain('review-requested:@me')
        expect(incrementUsage).toHaveBeenCalledWith(1, 'ai_queries')
    })

    it('serves the cached translation on the second identical call', async () => {
        mockGenerate.mockResolvedValue({
            text: JSON.stringify({ summary: 's', queries: [{ type: 'pr', ghQuery: 'is:pr' }] }),
        })
        const app = await buildApp()
        await request(app).post('/api/ai/translate-search').send({ q: 'open PRs' })
        const r2 = await request(app).post('/api/ai/translate-search').send({ q: 'open PRs' })
        expect(r2.body.cached).toBe(true)
        expect(mockGenerate).toHaveBeenCalledTimes(1)
        expect(incrementUsage).toHaveBeenCalledTimes(1)
    })

    it('rejects empty q with 400', async () => {
        const res = await request(await buildApp()).post('/api/ai/translate-search').send({ q: '' })
        expect(res.status).toBe(400)
    })

    it('rejects oversize q with 400', async () => {
        const res = await request(await buildApp())
            .post('/api/ai/translate-search')
            .send({ q: 'x'.repeat(501) })
        expect(res.status).toBe(400)
    })

    it('returns shaped fallback when the model emits garbage', async () => {
        mockGenerate.mockResolvedValue({ text: 'not json at all' })
        const res = await request(await buildApp())
            .post('/api/ai/translate-search')
            .send({ q: 'something' })
        expect(res.status).toBe(200)
        expect(res.body.fallback).toBe(true)
        expect(res.body.queries).toEqual([])
    })

    it('returns 429 when the user is over the AI quota', async () => {
        checkUsageLimit.mockImplementation(() => ({ allowed: false, current: 100, limit: 100, remaining: 0 }))
        const res = await request(await buildApp())
            .post('/api/ai/translate-search')
            .send({ q: 'open PRs' })
        expect(res.status).toBe(429)
        expect(mockGenerate).not.toHaveBeenCalled()
    })

    // Regression coverage for FIX-2 (2026-07-17 audit): translate-search used
    // to call providerGenerateWithRetry() directly, bypassing the monthly
    // spend cap that guardedGenerate() enforces everywhere else.
    it('routes through guardedGenerate: returns 429 AI_SPEND_CAP_REACHED and never calls the provider when over cap', async () => {
        checkAISpendCap.mockImplementation(() => ({ allowed: false, capCents: 500, spentCents: 500 }))
        const res = await request(await buildApp())
            .post('/api/ai/translate-search')
            .send({ q: 'open PRs' })
        expect(res.status).toBe(429)
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED')
        expect(mockGenerate).not.toHaveBeenCalled()
    })

    it('records spend via guardedGenerate on a successful call', async () => {
        mockGenerate.mockResolvedValue({
            text: JSON.stringify({ summary: 's', queries: [{ type: 'pr', ghQuery: 'is:pr' }] }),
            costUSD: 0.004,
        })
        const res = await request(await buildApp())
            .post('/api/ai/translate-search')
            .send({ q: 'open PRs, spend-tracked' })
        expect(res.status).toBe(200)
        expect(recordAISpend).toHaveBeenCalledWith(1, 0.004)
    })
})
