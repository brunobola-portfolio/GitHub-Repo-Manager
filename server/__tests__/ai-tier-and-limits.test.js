import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// ---------------------------------------------------------------------------
// Module-level mocks — order matters: mock before any dynamic import
// ---------------------------------------------------------------------------

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockCheckUsageLimit = vi.fn()
const mockIncrementUsage = vi.fn()
const mockCheckAIFeatureLimit = vi.fn()
const mockIncrementAIUsage = vi.fn()
vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: (...args) => mockCheckUsageLimit(...args),
    incrementUsage: (...args) => mockIncrementUsage(...args),
    checkAIFeatureLimit: (...args) => mockCheckAIFeatureLimit(...args),
    incrementAIUsage: (...args) => mockIncrementAIUsage(...args),
    quotaExceededResponse: (check) => ({
        error: 'usage_limit_exceeded',
        metric: check.metric,
        limit: check.limit,
        current: check.current,
        upgradeUrl: '/pricing',
    }),
}))

const mockGetFeatures = vi.fn()
vi.mock('../lib/feature-flags.js', () => ({
    getFeatures: (...args) => mockGetFeatures(...args),
    getTierOrder: (tier) => ({ free: 0, pro: 1, enterprise: 2 }[tier] ?? 0),
    canAccess: vi.fn(() => true),
}))

// requireTier: real implementation uses getUserTier which reads DB/env.
// Replace with a version that reads req.session.userTier to keep tests simple.
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: (minTier) => (req, res, next) => {
        const order = { free: 0, pro: 1, enterprise: 2 }
        const userOrder = order[req.session?.userTier ?? 'free'] ?? 0
        const minOrder = order[minTier] ?? 0
        if (userOrder >= minOrder) return next()
        return res.status(403).json({
            error: 'upgrade_required',
            message: `This feature requires the ${minTier} plan`,
            currentTier: req.session?.userTier ?? 'free',
            requiredTier: minTier,
        })
    },
    getUserTier: vi.fn(() => 'free'),
    attachTier: (req, _res, next) => next(),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
        next()
    },
    createRequireAI: () => (req, res, next) => next(),
    safeError: (err, fallback) => err?.message || fallback,
    errorResponse: (res, status, message, code) => res.status(status).json({ error: message, code }),
}))

vi.mock('../ai-service.js', () => ({
    aiService: { model: {}, genAI: {}, findSimilarById: vi.fn() },
    sanitizeForPrompt: (s) => s,
}))

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }))
vi.mock('../lib/utils.js', () => ({ safeJsonParse: vi.fn((v) => JSON.parse(v)) }))

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

// lib/validators is used by the teams router
// teams.js migrated to the new validateBody middleware, which calls
// schema.safeParse(); stub the handful of schemas it consumes with a
// permissive Zod schema so validation is a no-op in these tests.
vi.mock('../lib/validators.js', async () => {
    const { z } = await import('zod')
    const permissive = z.any()
    return {
        validate: () => (req, res, next) => next(),
        teamCreateSchema: permissive,
        teamMemberSchema: permissive,
        teamRepoSchema: permissive,
        aiChatSchema: {},
        aiSuggestSchema: {},
        aiIndexSchema: {},
        aiIssueToPlanSchema: {},
        migrationSizeStrategySchema: {},
        migrationDescriptionSchema: {},
    }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides = {}) {
    return {
        accessToken: 'tok',
        userId: 42,
        userTier: 'free',
        user: { id: 42, login: 'alice', tier: 'free' },
        ...overrides,
    }
}

async function buildApp(routerFactory) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = makeSession()
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    const router = await routerFactory()
    return { app, router }
}

// ---------------------------------------------------------------------------
// TEST 1 — GET /api/ai/search: available on Free (capped by ai_semantic_search),
// returns 429 when the per-feature cap is hit.
// ---------------------------------------------------------------------------

describe('GET /api/ai/search — free-tier access + per-feature cap', () => {
    let app
    beforeEach(async () => {
        vi.clearAllMocks()
        const express2 = express()
        express2.use(express.json())
        // Free user — userTier = 'free'
        express2.use((req, _res, next) => {
            req.session = makeSession({ userTier: 'free' })
            req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
            next()
        })
        const { default: aiRouter } = await import('../routes/ai.js')
        express2.use('/api', aiRouter)
        app = express2
    })

    it('allows a free-tier user under the per-feature cap', async () => {
        mockCheckAIFeatureLimit.mockReturnValue({ allowed: true, current: 3, limit: 50, remaining: 47, metric: 'ai_semantic_search' })
        const { default: db } = await import('../db.js')
        db.prepare.mockReturnValue({ get: vi.fn(() => null), all: vi.fn(() => []) })
        const { aiService } = await import('../ai-service.js')
        aiService.semanticSearch = vi.fn().mockResolvedValue([])

        const res = await request(app).get('/api/ai/search?q=react')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body)).toBe(true)
    })

    it('returns 429 usage_limit_exceeded when the per-feature semantic search cap is hit', async () => {
        mockCheckAIFeatureLimit.mockReturnValue({ allowed: false, current: 50, limit: 50, remaining: 0, metric: 'ai_semantic_search' })
        const res = await request(app).get('/api/ai/search?q=react')
        expect(res.status).toBe(429)
        expect(res.body.error).toBe('usage_limit_exceeded')
        expect(res.body.metric).toBe('ai_semantic_search')
        expect(res.body.upgradeUrl).toBe('/pricing')
    })
})

// ---------------------------------------------------------------------------
// TEST 2 — POST /api/ai/suggest returns 429 when usage limit is exceeded
// ---------------------------------------------------------------------------

describe('POST /api/ai/suggest — 429 when limit exceeded', () => {
    let app
    beforeEach(async () => {
        vi.clearAllMocks()
        const express2 = express()
        express2.use(express.json())
        express2.use((req, _res, next) => {
            req.session = makeSession({ userTier: 'pro' })
            req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
            next()
        })
        const { default: aiRouter } = await import('../routes/ai.js')
        express2.use('/api', aiRouter)
        app = express2
    })

    it('returns 429 with upgradeUrl when checkUsageLimit returns allowed: false', async () => {
        mockCheckUsageLimit.mockReturnValue({ allowed: false, current: 5000, limit: 5000, remaining: 0 })
        const res = await request(app)
            .post('/api/ai/suggest')
            .send({ repo: { name: 'test', id: 1 } })
        expect(res.status).toBe(429)
        expect(res.body.error).toMatch(/limit/i)
        expect(res.body.upgradeUrl).toBe('/pricing')
        expect(res.body.limit).toBe(5000)
    })

    it('allows request when checkUsageLimit returns allowed: true', async () => {
        mockCheckUsageLimit.mockReturnValue({ allowed: true, current: 0, limit: 5000, remaining: 5000 })
        const { aiService } = await import('../ai-service.js')
        // aiService.model.generateContent — mock it
        aiService.model = {
            generateContent: vi.fn().mockResolvedValue({
                response: { text: () => JSON.stringify({ suggestions: [], analysis: 'ok' }) }
            })
        }
        const res = await request(app)
            .post('/api/ai/suggest')
            .send({ repo: { name: 'test', id: 1 } })
        // 200 or 502 are both acceptable — what matters is NOT 429
        expect(res.status).not.toBe(429)
    })
})

// ---------------------------------------------------------------------------
// TEST 3 — GET /api/v1/audit/logs returns 403 for non-enterprise tier
// ---------------------------------------------------------------------------

describe('GET /api/v1/audit/logs — enterprise gate', () => {
    let app
    beforeEach(async () => {
        vi.clearAllMocks()
        const express2 = express()
        express2.use(express.json())
        express2.use((req, _res, next) => {
            req.session = makeSession({ userTier: 'free' })
            req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
            next()
        })
        // audit router is mounted at /audit in the main app; mount it here
        const { default: auditRouter } = await import('../routes/audit.js')
        // Wrap with requireTier guard to test the gate
        const { requireTier } = await import('../middleware/require-tier.js')
        express2.use('/api/v1/audit/logs', requireTier('enterprise'), auditRouter)
        app = express2
    })

    it('returns 403 for free-tier user', async () => {
        const res = await request(app).get('/api/v1/audit/logs')
        expect(res.status).toBe(403)
        expect(res.body.error).toBe('upgrade_required')
    })
})

// ---------------------------------------------------------------------------
// TEST 4 — POST /api/v1/teams/:id/members returns 403 when teamMembersMax exceeded
// ---------------------------------------------------------------------------

describe('POST /api/v1/teams/:id/members — teamMembersMax limit (Pro at 15)', () => {
    let app
    beforeEach(async () => {
        vi.clearAllMocks()
        const { default: db } = await import('../db.js')

        // Simulate pro user who is an admin of the team, and the team already has 15 members
        db.prepare.mockImplementation((sql) => {
            if (sql.includes('SELECT role FROM team_members')) {
                return { get: vi.fn(() => ({ role: 'admin' })) }
            }
            if (sql.includes('COUNT(*)')) {
                return { get: vi.fn(() => ({ n: 15 })) }
            }
            return { get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn(() => ({ changes: 1 })) }
        })

        mockGetFeatures.mockReturnValue({
            maxRepos: Infinity,
            aiQueriesPerMonth: 5000,
            teamMembersMax: 15,
            apiKeys: 10,
        })

        const express2 = express()
        express2.use(express.json())
        express2.use((req, _res, next) => {
            req.session = makeSession({ userTier: 'pro', user: { id: 42, login: 'alice', tier: 'pro' } })
            req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
            next()
        })
        const { default: teamsRouter } = await import('../routes/teams.js')
        express2.use('/api/v1/teams', teamsRouter)
        app = express2
    })

    it('returns 403 when team is already at Pro teamMembersMax (15)', async () => {
        const res = await request(app)
            .post('/api/v1/teams/1/members')
            .send({ username: 'newuser' })
        expect(res.status).toBe(403)
        // The error message mentions the limit
        expect(res.body.error).toMatch(/15/)
    })
})

// ---------------------------------------------------------------------------
// TEST 5 — POST /api/v1/api-keys returns 403 when apiKeys limit exceeded (Free at 2)
// ---------------------------------------------------------------------------

describe('POST /api/v1/api-keys — apiKeys limit (Free at 2)', () => {
    let app
    beforeEach(async () => {
        vi.clearAllMocks()
        const { default: db } = await import('../db.js')

        // Current key count = 2 (at limit)
        db.prepare.mockImplementation((sql) => {
            if (sql.includes('COUNT(*)')) {
                return { get: vi.fn(() => ({ n: 2 })) }
            }
            return { get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })) }
        })

        // Free tier: apiKeys = 2
        mockGetFeatures.mockReturnValue({
            maxRepos: 50,
            aiQueriesPerMonth: 100,
            teamMembersMax: 0,
            apiKeys: 2,
        })

        const express2 = express()
        express2.use(express.json())
        express2.use((req, _res, next) => {
            req.session = makeSession({ userTier: 'free', user: { id: 42, login: 'alice', tier: 'free' } })
            req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
            next()
        })
        const { default: apiKeysRouter } = await import('../routes/api-keys.js')
        express2.use('/api/v1/api-keys', apiKeysRouter)
        app = express2
    })

    it('returns 403 when free user already has 2 API keys', async () => {
        const res = await request(app)
            .post('/api/v1/api-keys')
            .send({ name: 'My Key', scopes: ['read'] })
        expect(res.status).toBe(403)
        expect(res.body.upgradeUrl).toBe('/pricing')
        expect(res.body.limit).toBe(2)
    })

    it('returns 201 when free user has fewer than 2 keys', async () => {
        const { default: db } = await import('../db.js')
        db.prepare.mockImplementation((sql) => {
            if (sql.includes('COUNT(*)')) {
                return { get: vi.fn(() => ({ n: 1 })) } // Only 1 key, limit is 2
            }
            return { get: vi.fn(() => null), all: vi.fn(() => []), run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })) }
        })

        const res = await request(app)
            .post('/api/v1/api-keys')
            .send({ name: 'My Key', scopes: ['read'] })
        expect(res.status).toBe(201)
    })
})
