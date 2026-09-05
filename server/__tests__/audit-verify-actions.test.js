// @vitest-environment node
/**
 * G6 — audit log as a page: server-side additions.
 *
 *  - GET /audit/actions returns only the DISTINCT actions belonging to the
 *    requesting tenant (never another tenant's actions).
 *  - GET /audit/verify walks the hash chain via verifyAuditChain() and maps
 *    { valid, totalChecked, brokenAt } onto { ok, checked, brokenAt }; a
 *    tampered row is detected and reported.
 *  - Both are gated the same way as the existing list route (auditLog flag +
 *    requireTier('enterprise')), not the auditExport flag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

let actionRows = []
const all = vi.fn((...args) => {
    // Distinguish the /actions query (SELECT DISTINCT action ...) from any
    // other prepared statement by inspecting the bound user_id argument only
    // — the mock doesn't need to parse SQL, just scope by tenant.
    return actionRows.filter((r) => r.user_id === args[0]).map((r) => ({ action: r.action }))
})
vi.mock('../db.js', () => ({
    default: { prepare: vi.fn(() => ({ all: (...a) => all(...a), get: () => ({ total: 0 }) })) },
}))

let sessionUserId = 7
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => { req.session = { userId: sessionUserId }; next() },
}))

let currentTier = 'enterprise'
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (req, res, next) => (
        currentTier === 'enterprise' ? next() : res.status(403).json({ error: 'Tier required' })
    ),
    getUserTier: () => currentTier,
}))

let features = { auditLog: true, auditExport: true }
vi.mock('../lib/feature-flags.js', () => ({ getFeatures: () => features }))

const auditLogFn = vi.fn()
let verifyResult = { valid: true, totalChecked: 3 }
vi.mock('../lib/audit.js', () => ({
    auditLog: (...a) => auditLogFn(...a),
    verifyAuditChain: (...a) => verifyAuditChainMock(...a),
}))
const verifyAuditChainMock = vi.fn(() => verifyResult)

const { default: auditRouter } = await import('../routes/audit.js')

function makeApp() {
    const app = express()
    app.use('/audit', auditRouter)
    return app
}

beforeEach(() => {
    vi.clearAllMocks()
    sessionUserId = 7
    currentTier = 'enterprise'
    features = { auditLog: true, auditExport: true }
    verifyResult = { valid: true, totalChecked: 3 }
    actionRows = [
        { user_id: 7, action: 'auth.login' },
        { user_id: 7, action: 'repo.delete' },
        { user_id: 99, action: 'team.create' }, // another tenant — must never leak
    ]
})

describe('GET /audit/actions', () => {
    it('returns only the requesting tenant\'s distinct actions', async () => {
        const res = await request(makeApp()).get('/audit/actions')
        expect(res.status).toBe(200)
        expect(res.body.actions.sort()).toEqual(['auth.login', 'repo.delete'])
    })

    it('never leaks another tenant\'s actions', async () => {
        const res = await request(makeApp()).get('/audit/actions')
        expect(res.body.actions).not.toContain('team.create')
    })

    it('scopes by the session user, not a client-supplied one', async () => {
        sessionUserId = 99
        const res = await request(makeApp()).get('/audit/actions')
        expect(res.body.actions).toEqual(['team.create'])
    })

    it('is refused for a non-Enterprise tier', async () => {
        currentTier = 'pro'
        const res = await request(makeApp()).get('/audit/actions')
        expect(res.status).toBe(403)
    })

    it('is refused when auditLog is off even for Enterprise', async () => {
        features = { auditLog: false }
        const res = await request(makeApp()).get('/audit/actions')
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('TIER_REQUIRED_ENTERPRISE')
    })
})

describe('GET /audit/verify', () => {
    it('reports an intact chain as ok with the checked count', async () => {
        verifyResult = { valid: true, totalChecked: 42 }
        const res = await request(makeApp()).get('/audit/verify')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ ok: true, checked: 42, brokenAt: null, unhashedLegacy: undefined })
    })

    it('detects a tampered row and reports where the chain broke', async () => {
        verifyResult = { valid: false, totalChecked: 5, brokenAt: 6 }
        const res = await request(makeApp()).get('/audit/verify')
        expect(res.status).toBe(200)
        expect(res.body.ok).toBe(false)
        expect(res.body.checked).toBe(5)
        expect(res.body.brokenAt).toBe(6)
    })

    it('is refused for a non-Enterprise tier', async () => {
        currentTier = 'pro'
        const res = await request(makeApp()).get('/audit/verify')
        expect(res.status).toBe(403)
        expect(verifyAuditChainMock).not.toHaveBeenCalled()
    })

    it('is refused when auditLog is off even for Enterprise', async () => {
        features = { auditLog: false }
        const res = await request(makeApp()).get('/audit/verify')
        expect(res.status).toBe(403)
        expect(verifyAuditChainMock).not.toHaveBeenCalled()
    })

    it('audits the verification itself', async () => {
        verifyResult = { valid: true, totalChecked: 2 }
        await request(makeApp()).get('/audit/verify')
        expect(auditLogFn).toHaveBeenCalledWith(
            expect.anything(), 'audit.verify', 'audit', null,
            expect.objectContaining({ ok: true, checked: 2 }),
        )
    })
})
