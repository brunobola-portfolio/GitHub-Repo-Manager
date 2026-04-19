// server/__tests__/ai-migration-size-strategy.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before any import touches server/config.js
// ---------------------------------------------------------------------------

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
        next()
    },
    // createRequireAI returns a middleware that passes through when req.genAI is set,
    // or rejects 503 when it is not, mirroring the real factory behaviour.
    createRequireAI: () => (req, res, next) => {
        if (!req.genAI) {
            return res.status(503).json({ error: 'AI_NOT_CONFIGURED' })
        }
        next()
    },
    safeError: (err, fallback) => err?.message || fallback,
    isValidGitHubFullName: (s) => /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(s),
}))

vi.mock('../ai-service.js', () => ({
    aiService: { model: {}, genAI: {} },
    sanitizeForPrompt: (s, max) => String(s ?? '').slice(0, max ?? 200),
}))

vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: vi.fn(() => ({ allowed: true, current: 0, limit: 100, remaining: 100 })),
    incrementUsage: vi.fn(),
    checkAIFeatureLimit: vi.fn(() => ({ allowed: true, current: 0, limit: 5, remaining: 5 })),
    incrementAIUsage: vi.fn(),
    quotaExceededResponse: (check) => ({
        error: 'usage_limit_exceeded',
        metric: check.metric,
        limit: check.limit,
        current: check.current,
        upgradeUrl: '/pricing',
    }),
}))

vi.mock('../lib/utils.js', () => ({
    safeJsonParse: (v) => { try { return JSON.parse(v) } catch { return null } },
}))

vi.mock('../lib/validators.js', async () => {
    const actual = await vi.importActual('../lib/validators.js')
    return { ...actual }
})

vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({
            get: vi.fn(() => null),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 1 })),
        })),
        transaction: (fn) => fn,
    },
}))

vi.mock('../lib/github-api.js', () => ({
    githubApi: vi.fn(() => Promise.resolve({ data: {} })),
}))

// ---------------------------------------------------------------------------
// App builder — sets up req.session and req.genAI via middleware before router
// ---------------------------------------------------------------------------

function buildApp({ authed = true, aiAvailable = true, geminiResponse = null, geminiThrows = null } = {}) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        if (authed) {
            req.session = { userId: 'user-1', accessToken: 'ghtoken' }
        }
        req.log = { error: () => {}, warn: () => {}, info: () => {} }
        const mockGenContent = async () => {
            if (geminiThrows) throw geminiThrows
            return {
                response: {
                    text: () => geminiResponse ?? JSON.stringify({
                        strategy: 'lfs-migrate',
                        rationale: 'binary assets',
                        confidence: 0.75,
                    }),
                },
            }
        }
        req.genAI = aiAvailable ? { getGenerativeModel: () => ({ generateContent: mockGenContent }) } : null
        // Inject req.aiProvider for routes migrated to the new provider abstraction.
        // generate() strips fences like the real provider and returns { text }.
        req.aiProvider = aiAvailable ? {
            generate: async () => {
                const result = await mockGenContent()
                const raw = result.response.text()
                const text = raw.replace(/```json/g, '').replace(/```/g, '').trim()
                return { text }
            },
            generateStream: async function* () {},
        } : null
        next()
    })
    return app
}

describe('POST /api/ai/migration-size-strategy', () => {
    let aiRouter

    beforeEach(async () => {
        vi.clearAllMocks()
        // Dynamic import ensures mocks are in place before the module loads
        const mod = await import('../routes/ai.js')
        aiRouter = mod.default
    })

    it('returns 200 with a valid strategy payload', async () => {
        const app = buildApp()
        app.use('/api', aiRouter)
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a', size: 11 * 1024 * 1024, hasLfsMarker: false, branches: 3 })
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({
            strategy: expect.stringMatching(/^(exclude|lfs-migrate)$/),
            rationale: expect.any(String),
            confidence: expect.any(Number),
        })
    })

    it('returns 400 on invalid body', async () => {
        const app = buildApp()
        app.use('/api', aiRouter)
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a' }) // missing size
        expect(res.status).toBe(400)
    })

    it('accepts lastCommitDate: null (TFVC folders have no commit metadata)', async () => {
        const app = buildApp()
        app.use('/api', aiRouter)
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({
                repoId: '$/APOS - Advanced POS/Cacadores',
                size: 11 * 1024 * 1024,
                hasLfsMarker: false,
                branches: 0,
                lastCommitDate: null,
            })
        expect(res.status).toBe(200)
    })

    it('returns 401 without auth', async () => {
        const app = buildApp({ authed: false })
        app.use('/api', aiRouter)
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a', size: 11 * 1024 * 1024 })
        expect(res.status).toBe(401)
    })

    it('returns 502 when AI produces an unexpected response shape', async () => {
        const app = buildApp({ geminiResponse: 'not json' })
        app.use('/api', aiRouter)
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a', size: 11 * 1024 * 1024, hasLfsMarker: false, branches: 3 })
        expect(res.status).toBe(502)
    })

    it('accepts JSON wrapped in ```json markdown fences (Gemini default shape)', async () => {
        const wrapped = '```json\n{"strategy":"lfs-migrate","rationale":"binary assets","confidence":0.8}\n```'
        const app = buildApp({ geminiResponse: wrapped })
        app.use('/api', aiRouter)
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a', size: 11 * 1024 * 1024, hasLfsMarker: false, branches: 3 })
        expect(res.status).toBe(200)
        expect(res.body.strategy).toBe('lfs-migrate')
    })

    it('returns 401 when requireAI rejects (genAI unavailable)', async () => {
        const app = buildApp({ aiAvailable: false })
        app.use('/api', aiRouter)
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a', size: 11 * 1024 * 1024 })
        // requireAI middleware responds with 401 or 503 depending on project pattern.
        expect([401, 503]).toContain(res.status)
    })
})
