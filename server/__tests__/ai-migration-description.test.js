import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
        next()
    },
    createRequireAI: () => (req, res, next) => {
        if (!req.genAI) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' })
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

function buildApp({ authed = true, aiAvailable = true, geminiResponse = null, geminiThrows = null } = {}) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        if (authed) req.session = { userId: 'user-1', accessToken: 'ghtoken' }
        req.log = { error: () => {}, warn: () => {}, info: () => {} }
        req.genAI = aiAvailable ? {
            getGenerativeModel: () => ({
                generateContent: async () => {
                    if (geminiThrows) throw geminiThrows
                    return {
                        response: {
                            text: () => geminiResponse ?? JSON.stringify({
                                description: 'A modernization of the legacy POS client, migrated from Azure DevOps TFVC.',
                            }),
                        },
                    }
                },
            }),
        } : null
        next()
    })
    return app
}

const validBody = {
    repoId: 'r1',
    repoName: 'Cacadores',
    language: 'C#',
    size: 12 * 1024 * 1024,
    branches: 0,
    hasLfsMarker: false,
    lastCommitDate: null,
    source: {
        org: 'brunobola',
        project: 'APOS - Advanced POS',
        isTfvc: true,
        tfvcPath: '$/APOS - Advanced POS/Cacadores',
    },
}

describe('POST /api/ai/migration-description', () => {
    let aiRouter

    beforeEach(async () => {
        vi.clearAllMocks()
        const mod = await import('../routes/ai.js')
        aiRouter = mod.default
    })

    it('returns 200 with a sanitized description from Gemini', async () => {
        const app = buildApp()
        app.use('/api', aiRouter)
        const res = await request(app).post('/api/ai/migration-description').send(validBody)
        expect(res.status).toBe(200)
        expect(res.body.description).toBe('A modernization of the legacy POS client, migrated from Azure DevOps TFVC.')
    })

    it('strips markdown, newlines, and emoji from the Gemini output', async () => {
        const app = buildApp({
            geminiResponse: JSON.stringify({
                description: '🚀 Ship it 🎉\n\n```\ncode\n```\nUses `React`',
            }),
        })
        app.use('/api', aiRouter)
        const res = await request(app).post('/api/ai/migration-description').send(validBody)
        expect(res.status).toBe(200)
        expect(res.body.description).toBe('Ship it Uses React')
    })

    it('truncates descriptions longer than 350 chars on word boundary with ellipsis', async () => {
        const long = 'lorem '.repeat(100)
        const app = buildApp({ geminiResponse: JSON.stringify({ description: long }) })
        app.use('/api', aiRouter)
        const res = await request(app).post('/api/ai/migration-description').send(validBody)
        expect(res.status).toBe(200)
        expect(res.body.description.length).toBeLessThanOrEqual(350)
        expect(res.body.description.endsWith('…')).toBe(true)
    })

    it('falls back to deterministic template when Gemini returns malformed JSON (still 200)', async () => {
        const app = buildApp({ geminiResponse: 'not json at all' })
        app.use('/api', aiRouter)
        const res = await request(app).post('/api/ai/migration-description').send(validBody)
        expect(res.status).toBe(200)
        expect(res.body.description).toBe('Migrated from Azure DevOps TFVC: APOS - Advanced POS/Cacadores')
    })

    it('falls back to template when Gemini returns JSON without a description field', async () => {
        const app = buildApp({ geminiResponse: JSON.stringify({ other: 'thing' }) })
        app.use('/api', aiRouter)
        const res = await request(app).post('/api/ai/migration-description').send(validBody)
        expect(res.status).toBe(200)
        expect(res.body.description).toMatch(/^Migrated from Azure DevOps TFVC:/)
    })

    it('returns 400 on invalid body (missing source.project)', async () => {
        const app = buildApp()
        app.use('/api', aiRouter)
        const res = await request(app).post('/api/ai/migration-description').send({
            ...validBody,
            source: { ...validBody.source, project: '' },
        })
        expect(res.status).toBe(400)
    })

    it('returns 401 without auth', async () => {
        const app = buildApp({ authed: false })
        app.use('/api', aiRouter)
        const res = await request(app).post('/api/ai/migration-description').send(validBody)
        expect(res.status).toBe(401)
    })

    it('returns 401 or 503 when AI is not configured', async () => {
        const app = buildApp({ aiAvailable: false })
        app.use('/api', aiRouter)
        const res = await request(app).post('/api/ai/migration-description').send(validBody)
        expect([401, 503]).toContain(res.status)
    })
})
