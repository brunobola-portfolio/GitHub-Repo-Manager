// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockProvider = { generate: vi.fn().mockResolvedValue({ text: 'This looks good overall but needs a test for the edge case.' }) }

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

vi.mock('../lib/github-api.js', () => ({
    githubApi: vi.fn().mockResolvedValue({
        data: [{ filename: 'src/auth.js', patch: '@@ -1,3 +1,4 @@ \n+const x = 1;' }],
    }),
}))

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

const { default: workBoardActionsRouter } = await import('../routes/work-board-actions.js')

const app = express()
app.use(express.json())
app.use('/api/v1/work-board', workBoardActionsRouter)

describe('POST /api/v1/work-board/draft-comment', () => {
    it('returns { draft } on success', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/draft-comment')
            .send({ repoFullName: 'acme/api', prNumber: 42, intent: 'request_changes' })
        expect(res.status).toBe(200)
        expect(typeof res.body.draft).toBe('string')
        expect(res.body.draft.length).toBeGreaterThan(0)
    })

    it('returns 403 when no AI provider', async () => {
        const { createProviderForUser } = await import('../lib/ai-provider.js')
        vi.mocked(createProviderForUser).mockResolvedValueOnce(null)
        const res = await request(app)
            .post('/api/v1/work-board/draft-comment')
            .send({ repoFullName: 'acme/api', prNumber: 42, intent: 'comment' })
        expect(res.status).toBe(403)
    })
})
