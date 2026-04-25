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
    quotaExceededResponse: (check) => ({
        error: 'usage_limit_exceeded', limit: check.limit, current: check.current,
    }),
}))

vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({ get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn(() => ({ changes: 1 })) })),
        transaction: (fn) => fn,
    },
}))

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn(() => Promise.resolve({ data: {} })) }))
vi.mock('../middleware/validate-request.js', async () => {
    const actual = await vi.importActual('../middleware/validate-request.js')
    return actual
})

const { clearNarrativeCache } = await import('../lib/attention-narrative.js')

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

describe('POST /api/ai/attention-narrative', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        clearNarrativeCache()
        checkUsageLimit.mockImplementation(() => ({ allowed: true, current: 0, limit: 100, remaining: 100 }))
    })

    it('returns the shaped narrative on first call (cached: false)', async () => {
        mockGenerate.mockResolvedValue({ text: '"Two stale PRs and a failing CI on main since Tuesday."' })
        const app = await buildApp()

        const res = await request(app)
            .post('/api/ai/attention-narrative')
            .send({ repo: 'acme/api', kind: 'hot', signal: { stale: 2 } })

        expect(res.status).toBe(200)
        expect(res.body.cached).toBe(false)
        expect(res.body.narrative).toBe('Two stale PRs and a failing CI on main since Tuesday.')
        expect(res.body.model).toBe('gemini-test')
        expect(incrementUsage).toHaveBeenCalledWith(1, 'ai_queries')
    })

    it('serves the cached narrative on the second identical call without billing', async () => {
        mockGenerate.mockResolvedValue({ text: 'Cached me once.' })
        const app = await buildApp()
        const body = { repo: 'acme/api', kind: 'hot', signal: { stale: 2 } }

        await request(app).post('/api/ai/attention-narrative').send(body)
        const res2 = await request(app).post('/api/ai/attention-narrative').send(body)

        expect(res2.status).toBe(200)
        expect(res2.body.cached).toBe(true)
        expect(mockGenerate).toHaveBeenCalledTimes(1)
        expect(incrementUsage).toHaveBeenCalledTimes(1)
    })

    it('busts the cache when the signal payload changes', async () => {
        mockGenerate.mockResolvedValueOnce({ text: 'first' }).mockResolvedValueOnce({ text: 'second' })
        const app = await buildApp()

        const a = await request(app)
            .post('/api/ai/attention-narrative')
            .send({ repo: 'a/b', kind: 'hot', signal: { v: 1 } })
        const b = await request(app)
            .post('/api/ai/attention-narrative')
            .send({ repo: 'a/b', kind: 'hot', signal: { v: 2 } })

        expect(a.body.narrative).toBe('first')
        expect(b.body.narrative).toBe('second')
        expect(mockGenerate).toHaveBeenCalledTimes(2)
    })

    it('rejects an invalid kind with 400', async () => {
        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/attention-narrative')
            .send({ repo: 'a/b', kind: 'unknown', signal: {} })

        expect(res.status).toBe(400)
    })

    it('rejects a malformed repo with 400', async () => {
        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/attention-narrative')
            .send({ repo: 'not-a-slash', kind: 'hot', signal: {} })

        expect(res.status).toBe(400)
    })

    it('returns 502 AI_PARSE_ERROR when the model returns empty text', async () => {
        mockGenerate.mockResolvedValue({ text: '   ' })
        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/attention-narrative')
            .send({ repo: 'a/b', kind: 'hot', signal: {} })

        expect(res.status).toBe(502)
        expect(res.body.code).toBe('AI_PARSE_ERROR')
    })

    it('returns 429 when the user is over the AI quota', async () => {
        checkUsageLimit.mockImplementation(() => ({ allowed: false, current: 100, limit: 100, remaining: 0 }))
        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/attention-narrative')
            .send({ repo: 'a/b', kind: 'hot', signal: {} })

        expect(res.status).toBe(429)
        expect(mockGenerate).not.toHaveBeenCalled()
    })
})
