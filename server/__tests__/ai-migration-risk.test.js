// Tests for POST /api/ai/migration-risk added in the 2026-04-15 free-tier expansion.
// Covers: happy path with valid JSON, JSON parse-error fallback, full_name
// validation, and 429 quota handling.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockGenerateContent = vi.fn()
vi.mock('../ai-service.js', () => ({
    aiService: {
        model: { generateContent: (...args) => mockGenerateContent(...args) },
        genAI: {},
    },
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
        createRequireAI: () => (req, res, next) => next(),
    }
})

vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (req, res, next) => next(),
    getUserTier: vi.fn(() => 'free'),
}))

const mockCheckAIFeatureLimit = vi.fn()
const mockIncrementAIUsage = vi.fn()
const mockQuotaExceededResponse = vi.fn((check) => ({
    error: 'usage_limit_exceeded',
    metric: check.metric,
    limit: check.limit,
    current: check.current,
    upgradeUrl: '/pricing',
}))
vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: vi.fn(() => ({ allowed: true, current: 0, limit: 100, remaining: 100 })),
    incrementUsage: vi.fn(),
    checkAIFeatureLimit: (...args) => mockCheckAIFeatureLimit(...args),
    incrementAIUsage: (...args) => mockIncrementAIUsage(...args),
    quotaExceededResponse: (...args) => mockQuotaExceededResponse(...args),
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

vi.mock('../lib/utils.js', () => ({ safeJsonParse: (v) => JSON.parse(v) }))
vi.mock('../middleware/validate-request.js', () => ({
    validateBody: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => { req.validatedQuery = req.query; next(); },
    validateParams: () => (req, _res, next) => { req.validatedParams = req.params; next(); },
}))
vi.mock('../lib/validators.js', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        validate: () => (req, res, next) => next(),
    }
})

async function buildApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'tok', userId: 1, user: { id: 1, login: 'alice' } }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        // Inject req.aiProvider for routes migrated to the new provider abstraction.
        // generate() wraps mockGenerateContent and returns { text } matching provider contract.
        req.aiProvider = {
            generate: async () => {
                const result = await mockGenerateContent()
                return { text: result.response.text() }
            },
            generateStream: async function* () {},
        }
        next()
    })
    const { default: aiRouter } = await import('../routes/ai.js')
    app.use('/api', aiRouter)
    return app
}

describe('POST /api/ai/migration-risk', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockCheckAIFeatureLimit.mockReturnValue({
            allowed: true, current: 0, limit: 5, remaining: 5, metric: 'ai_migration_risk',
        })
    })

    it('returns a structured risk report for a valid repo', async () => {
        mockGenerateContent.mockResolvedValue({
            response: {
                text: () => JSON.stringify({
                    overallRisk: 'medium',
                    score: 45,
                    summary: 'Manageable with manual workflow re-wiring.',
                    blockers: [],
                    warnings: ['3 workflows need secret re-wiring'],
                    recommendations: ['Audit GitHub Actions secrets before migration'],
                    estimatedDurationMinutes: 45,
                }),
            },
        })

        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/migration-risk')
            .send({ repo: { full_name: 'octocat/hello-world', size: 1024 }, source: 'github', target: 'github' })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.report.repo).toBe('octocat/hello-world')
        expect(res.body.report.overallRisk).toBe('medium')
        expect(res.body.report.score).toBe(45)
        expect(res.body.report.warnings).toEqual(['3 workflows need secret re-wiring'])
        expect(res.body.report.parseError).toBe(false)
        expect(mockIncrementAIUsage).toHaveBeenCalledWith(1, 'ai_migration_risk')
    })

    it('falls back to overallRisk=unknown with parseError=true when AI returns garbage', async () => {
        mockGenerateContent.mockResolvedValue({
            response: { text: () => 'I am sorry, I cannot answer that.' },
        })

        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/migration-risk')
            .send({ repo: { full_name: 'octocat/hello-world' } })

        expect(res.status).toBe(200)
        expect(res.body.report.overallRisk).toBe('unknown')
        expect(res.body.report.score).toBe(0)
        expect(res.body.report.parseError).toBe(true)
        // raw preview should be surfaced in warnings so user/logs can see what went wrong
        expect(res.body.report.warnings[0]).toMatch(/AI parse error/i)
    })

    it('clamps out-of-range score and coerces non-array fields', async () => {
        mockGenerateContent.mockResolvedValue({
            response: {
                text: () => JSON.stringify({
                    overallRisk: 'nonsense-tier',  // not in allowed set → 'unknown'
                    score: 9999,                   // should clamp to 100
                    summary: 'ok',
                    blockers: null,                // not an array → []
                    warnings: 'one big string',    // not an array → []
                    recommendations: [1, 'valid', null],  // filter non-strings
                    estimatedDurationMinutes: 'later',     // non-number → 0
                }),
            },
        })

        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/migration-risk')
            .send({ repo: { full_name: 'octocat/hello-world' } })

        expect(res.status).toBe(200)
        expect(res.body.report.overallRisk).toBe('unknown')
        expect(res.body.report.score).toBe(100)
        expect(res.body.report.blockers).toEqual([])
        expect(res.body.report.warnings).toEqual([])
        expect(res.body.report.recommendations).toEqual(['valid'])
        expect(res.body.report.estimatedDurationMinutes).toBe(0)
    })

    it('rejects malformed repo.full_name to prevent URL injection', async () => {
        const app = await buildApp()

        for (const bad of ['../../../etc/passwd', 'owner/repo?token=leak', 'only-one-part', '', 'owner/repo/extra']) {
            const res = await request(app)
                .post('/api/ai/migration-risk')
                .send({ repo: { full_name: bad } })
            expect(res.status).toBe(400)
            expect(res.body.code).toBe('VALIDATION_ERROR')
        }
    })

    it('returns 400 when repo.full_name is missing', async () => {
        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/migration-risk')
            .send({ repo: {} })
        expect(res.status).toBe(400)
    })

    it('returns 429 with upgradeUrl when per-feature quota is hit', async () => {
        mockCheckAIFeatureLimit.mockReturnValue({
            allowed: false, current: 5, limit: 5, remaining: 0, metric: 'ai_migration_risk',
        })

        const app = await buildApp()
        const res = await request(app)
            .post('/api/ai/migration-risk')
            .send({ repo: { full_name: 'octocat/hello-world' } })

        expect(res.status).toBe(429)
        expect(res.body.error).toBe('usage_limit_exceeded')
        expect(res.body.metric).toBe('ai_migration_risk')
        expect(res.body.upgradeUrl).toBe('/pricing')
    })
})
