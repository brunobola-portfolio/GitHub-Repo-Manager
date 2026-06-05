// server/__tests__/bulk-safety.test.js
//
// TDD tests for the bulk-ops dry-run + confirmation-token safety layer.
// These tests cover all 10 required cases from the Phase 0 security prerequisite.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before any import touches server deps
// ---------------------------------------------------------------------------

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
        next()
    },
    isValidGitHubUsername: (s) => /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(s),
    safeError: (err, fallback) => err?.message || fallback || 'Operation failed',
    errorResponse: (res, status, message, code) => res.status(status).json({ error: message, code }),
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

// requireTier mock: checks req.userTier. Default is 'pro' (authed tier).
// Build helpers can set req.userTier = 'free' to test rejection.
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: (minTier) => (req, res, next) => {
        const tier = req.userTier || 'pro'
        const order = { free: 0, pro: 1, enterprise: 2 }
        if ((order[tier] ?? 0) >= (order[minTier] ?? 0)) return next()
        return res.status(403).json({
            error: 'upgrade_required',
            message: `This feature requires the ${minTier} plan`,
            currentTier: tier,
            requiredTier: minTier,
        })
    },
}))

// ---------------------------------------------------------------------------
// App builder helpers
// ---------------------------------------------------------------------------

function buildApp({ authed = true, tier = 'pro' } = {}) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        if (authed) {
            req.session = { userId: 'user-123', accessToken: 'ghtoken' }
        }
        req.userTier = tier
        req.log = { error: () => {}, warn: () => {}, info: () => {} }
        next()
    })
    return app
}

async function getBulkRouter() {
    vi.resetModules()
    const mod = await import('../routes/bulk.js')
    return mod.default
}

// ---------------------------------------------------------------------------
// Helper: get a valid dry-run confirmation token for delete
// ---------------------------------------------------------------------------
async function getDryRunToken(app, bulkRouter, repos) {
    const res = await request(app)
        .post('/bulk/delete')
        .send({ repos, dryRun: true })
    expect(res.status).toBe(200)
    expect(res.body.dryRun).toBe(true)
    return res.body.confirmationToken
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Bulk ops safety — dry-run + confirmation-token flow', () => {
    let bulkRouter

    beforeEach(async () => {
        vi.clearAllMocks()
        bulkRouter = await getBulkRouter()
    })

    // -------------------------------------------------------------------------
    // Case 1: POST /bulk/delete without dryRun AND without confirmation token → 400
    // -------------------------------------------------------------------------
    it('case 1: POST /bulk/delete without dryRun and without token → 400 confirmation-token-required', async () => {
        const { githubApi } = await import('../lib/github-api.js')
        const app = buildApp()
        app.use('/bulk', bulkRouter)
        const res = await request(app)
            .post('/bulk/delete')
            .send({ repos: ['owner/repo1'] })
        expect(res.status).toBe(400)
        expect(res.body.reason || res.body.code || res.body.error).toMatch(/confirmation/i)
        expect(githubApi).not.toHaveBeenCalled()
    })

    // -------------------------------------------------------------------------
    // Case 2: POST /bulk/delete with dryRun=true → 200 with token, no GitHub call
    // -------------------------------------------------------------------------
    it('case 2: POST /bulk/delete dryRun=true → 200, returns confirmationToken, no GitHub API call', async () => {
        const { githubApi } = await import('../lib/github-api.js')
        const app = buildApp()
        app.use('/bulk', bulkRouter)

        const res = await request(app)
            .post('/bulk/delete')
            .send({ repos: ['owner/repo1', 'owner/repo2'], dryRun: true })

        expect(res.status).toBe(200)
        expect(res.body.dryRun).toBe(true)
        expect(typeof res.body.confirmationToken).toBe('string')
        expect(res.body.expiresInSeconds).toBe(60)
        expect(res.body.plan).toBeDefined()
        expect(res.body.plan.action).toBe('bulk.delete')
        expect(res.body.plan.repos).toEqual(expect.arrayContaining(['owner/repo1', 'owner/repo2']))
        // No GitHub API should have been called
        expect(githubApi).not.toHaveBeenCalled()
    })

    // -------------------------------------------------------------------------
    // Case 3: POST /bulk/delete with stale/expired token → 400 expired
    // -------------------------------------------------------------------------
    it('case 3: POST /bulk/delete with expired token → 400 expired', async () => {
        const { githubApi } = await import('../lib/github-api.js')
        const { issueToken } = await import('../lib/bulk-confirmation.js')

        const app = buildApp()
        app.use('/bulk', bulkRouter)

        // Forge a token that has already expired by advancing the real system time
        vi.useFakeTimers()
        const realNow = Date.now()
        vi.setSystemTime(realNow - 120_000) // 2 minutes in the past

        const staleToken = issueToken({
            userId: 'user-123',
            action: 'bulk.delete',
            repos: ['owner/repo'],
            extraData: {},
        })

        vi.setSystemTime(realNow) // back to now — token is now 2 minutes old, TTL is 60s
        vi.useRealTimers()

        const res = await request(app)
            .post('/bulk/delete')
            .set('X-Bulk-Confirmation-Token', staleToken)
            .send({ repos: ['owner/repo'] })

        expect(res.status).toBe(400)
        expect(res.body.reason).toBe('expired')
        expect(githubApi).not.toHaveBeenCalled()
    })

    // -------------------------------------------------------------------------
    // Case 4: POST /bulk/delete with token for different repos → 400 repos-mismatch
    // -------------------------------------------------------------------------
    it('case 4: POST /bulk/delete with token for different repos → 400 repos-mismatch', async () => {
        const app = buildApp()
        app.use('/bulk', bulkRouter)

        // Get a token issued for repo1 only
        const tokenForRepo1 = await getDryRunToken(app, bulkRouter, ['owner/repo1'])

        // Now try to execute with repo2 — should mismatch
        const res = await request(app)
            .post('/bulk/delete')
            .set('X-Bulk-Confirmation-Token', tokenForRepo1)
            .send({ repos: ['owner/repo1', 'owner/repo2'] })  // different set

        expect(res.status).toBe(400)
        expect(JSON.stringify(res.body)).toMatch(/repos.mismatch/i)
    })

    // -------------------------------------------------------------------------
    // Case 5: POST /bulk/delete with valid fresh token → 200, GitHub called, audit logged
    // -------------------------------------------------------------------------
    it('case 5: POST /bulk/delete with valid fresh token → 200, GitHub API called, audit logged', async () => {
        const { githubApi } = await import('../lib/github-api.js')
        const { auditLog } = await import('../lib/audit.js')

        const app = buildApp()
        app.use('/bulk', bulkRouter)
        const repos = ['owner/repo1']

        // Step 1: dry-run to get token
        const token = await getDryRunToken(app, bulkRouter, repos)
        vi.clearAllMocks()

        // Step 2: execute with token
        const res = await request(app)
            .post('/bulk/delete')
            .set('X-Bulk-Confirmation-Token', token)
            .send({ repos })

        expect(res.status).toBe(200)
        expect(githubApi).toHaveBeenCalledWith(
            expect.stringContaining('/repos/owner/repo1'),
            expect.any(String),
            expect.objectContaining({ method: 'DELETE' })
        )
        // Audit log should include intent call AND outcome call
        expect(auditLog).toHaveBeenCalledWith(
            expect.anything(),
            'bulk.delete.intent',
            expect.any(String),
            expect.any(String),
            expect.anything()
        )
        expect(auditLog).toHaveBeenCalledWith(
            expect.anything(),
            'bulk.delete',
            expect.any(String),
            expect.any(String),
            expect.objectContaining({ successCount: 1 })
        )
    })

    // -------------------------------------------------------------------------
    // Case 6: POST /bulk/archive on free tier → allowed (basic bulk is free).
    // Archive/unarchive on your own repos is non-destructive and reversible, so
    // it ships on Free — only the dry-run → confirmation safety layer applies.
    // -------------------------------------------------------------------------
    it('case 6: POST /bulk/archive on free tier → 200 dry-run (basic bulk is free)', async () => {
        const app = buildApp({ tier: 'free' })
        app.use('/bulk', bulkRouter)

        const res = await request(app)
            .post('/bulk/archive')
            .send({ repos: ['owner/repo1'], dryRun: true })

        expect(res.status).toBe(200)
        expect(res.body.dryRun).toBe(true)
        expect(typeof res.body.confirmationToken).toBe('string')
    })

    // -------------------------------------------------------------------------
    // Case 7: POST /bulk/visibility on free tier → allowed (basic bulk is free).
    // -------------------------------------------------------------------------
    it('case 7: POST /bulk/visibility on free tier → 200 dry-run (basic bulk is free)', async () => {
        const app = buildApp({ tier: 'free' })
        app.use('/bulk', bulkRouter)

        const res = await request(app)
            .post('/bulk/visibility')
            .send({ repos: ['owner/repo1'], makePublic: true, dryRun: true })

        expect(res.status).toBe(200)
        expect(res.body.dryRun).toBe(true)
        expect(typeof res.body.confirmationToken).toBe('string')
    })

    // -------------------------------------------------------------------------
    // Cases 7a–7c: advanced/destructive bulk stays Pro-gated on free tier → 403.
    // De-gating basic bulk (visibility/archive) must NOT leak transfer, mirror,
    // or delete to Free — those remain Pro.
    // -------------------------------------------------------------------------
    it('case 7a: POST /bulk/transfer on free tier → 403 (advanced bulk stays Pro)', async () => {
        const app = buildApp({ tier: 'free' })
        app.use('/bulk', bulkRouter)

        const res = await request(app)
            .post('/bulk/transfer')
            .send({ repos: ['owner/repo1'], toOrg: 'my-org', dryRun: true })

        expect(res.status).toBe(403)
        expect(res.body.error).toBe('upgrade_required')
    })

    it('case 7b: POST /bulk/mirror on free tier → 403 (advanced bulk stays Pro)', async () => {
        const app = buildApp({ tier: 'free' })
        app.use('/bulk', bulkRouter)

        const res = await request(app)
            .post('/bulk/mirror')
            .send({ repos: ['owner/repo1'], toOrg: 'my-org', dryRun: true })

        expect(res.status).toBe(403)
        expect(res.body.error).toBe('upgrade_required')
    })

    it('case 7c: POST /bulk/delete on free tier → 403 (destructive bulk stays Pro)', async () => {
        const app = buildApp({ tier: 'free' })
        app.use('/bulk', bulkRouter)

        const res = await request(app)
            .post('/bulk/delete')
            .send({ repos: ['owner/repo1'], dryRun: true })

        expect(res.status).toBe(403)
        expect(res.body.error).toBe('upgrade_required')
    })

    // -------------------------------------------------------------------------
    // Case 8: POST /bulk/transfer dry-run → token bound to toOrg; changing toOrg → 400 extra-mismatch
    // -------------------------------------------------------------------------
    it('case 8: POST /bulk/transfer dry-run token bound to toOrg; changing toOrg → 400 extra-mismatch', async () => {
        const app = buildApp()
        app.use('/bulk', bulkRouter)

        // dry-run with toOrg = 'my-org'
        const dryRes = await request(app)
            .post('/bulk/transfer')
            .send({ repos: ['owner/repo1'], toOrg: 'my-org', dryRun: true })

        expect(dryRes.status).toBe(200)
        expect(dryRes.body.dryRun).toBe(true)
        const token = dryRes.body.confirmationToken

        // Execute with different toOrg — should fail extra-mismatch
        const execRes = await request(app)
            .post('/bulk/transfer')
            .set('X-Bulk-Confirmation-Token', token)
            .send({ repos: ['owner/repo1'], toOrg: 'different-org' })

        expect(execRes.status).toBe(400)
        expect(JSON.stringify(execRes.body)).toMatch(/extra.mismatch/i)
    })

    // -------------------------------------------------------------------------
    // Case 9: POST /bulk/community-health/compare still works without token (read-only)
    // -------------------------------------------------------------------------
    it('case 9: POST /bulk/community-health/compare works without token (read-only)', async () => {
        const { githubApi } = await import('../lib/github-api.js')
        githubApi.mockResolvedValue({ data: { id: 42 } })

        const app = buildApp()
        app.use('/bulk', bulkRouter)

        const res = await request(app)
            .post('/bulk/community-health/compare')
            .send({ repos: ['owner/repo1'] })

        // Should not get a 400 about token
        expect(res.status).not.toBe(400)
        expect(res.status).toBeLessThan(500)
    })

    // -------------------------------------------------------------------------
    // Case 10: POST /bulk/transfer/check-conflicts still works without token (read-only)
    // -------------------------------------------------------------------------
    it('case 10: POST /bulk/transfer/check-conflicts works without token (read-only)', async () => {
        const { githubApi } = await import('../lib/github-api.js')
        githubApi.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))

        const app = buildApp()
        app.use('/bulk', bulkRouter)

        const res = await request(app)
            .post('/bulk/transfer/check-conflicts')
            .send({ repos: ['owner/repo1'], targetOrg: 'my-org' })

        expect(res.status).not.toBe(400)
        expect(res.status).toBeLessThan(500)
        expect(res.body.conflicts).toBeDefined()
    })
})
