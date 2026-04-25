import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockGetStats = vi.fn(() => ({
    ok: 4, invalid: 1, unreachable: 0, unknown: 0, total: 5,
    lastOutcomeAt: '2026-04-26T18:00:00Z',
}))
const mockReset = vi.fn()
vi.mock('../lib/ai-health-probe.js', () => ({
    getProbeStats: (...a) => mockGetStats(...a),
    resetProbeStats: (...a) => mockReset(...a),
}))

vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js')
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
            next()
        },
    }
})

vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (req, res, next) => {
        if (req.session?.tier !== 'enterprise') return res.status(403).json({ error: 'Tier required' })
        next()
    },
}))

vi.mock('../middleware/require-admin.js', () => ({
    requireAdmin: (req, res, next) => {
        if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin required' })
        next()
    },
}))

const { default: adminAiRouter } = await import('../routes/admin-ai.js')

function buildApp({ session = {} } = {}) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = session
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/admin/ai', adminAiRouter)
    return app
}

const adminSession = { accessToken: 'tok', userId: 1, tier: 'enterprise', isAdmin: true }

describe('GET /api/admin/ai/probe-stats', () => {
    beforeEach(() => vi.clearAllMocks())

    it('returns the counter snapshot for an admin', async () => {
        const res = await request(buildApp({ session: adminSession })).get('/api/admin/ai/probe-stats')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({
            ok: 4, invalid: 1, unreachable: 0, unknown: 0, total: 5,
            lastOutcomeAt: '2026-04-26T18:00:00Z',
        })
        expect(mockGetStats).toHaveBeenCalledTimes(1)
    })

    it('returns 401 without a session', async () => {
        const res = await request(buildApp({ session: {} })).get('/api/admin/ai/probe-stats')
        expect(res.status).toBe(401)
        expect(mockGetStats).not.toHaveBeenCalled()
    })

    it('returns 403 for a Pro user (tier check)', async () => {
        const res = await request(buildApp({
            session: { accessToken: 'tok', userId: 1, tier: 'pro', isAdmin: true },
        })).get('/api/admin/ai/probe-stats')
        expect(res.status).toBe(403)
    })

    it('returns 403 for an enterprise non-admin', async () => {
        const res = await request(buildApp({
            session: { accessToken: 'tok', userId: 1, tier: 'enterprise', isAdmin: false },
        })).get('/api/admin/ai/probe-stats')
        expect(res.status).toBe(403)
    })
})

describe('POST /api/admin/ai/probe-stats/reset', () => {
    beforeEach(() => vi.clearAllMocks())

    it('returns 204 and resets counters for an admin', async () => {
        const res = await request(buildApp({ session: adminSession })).post('/api/admin/ai/probe-stats/reset')
        expect(res.status).toBe(204)
        expect(mockReset).toHaveBeenCalledTimes(1)
    })

    it('is idempotent — second call also 204', async () => {
        await request(buildApp({ session: adminSession })).post('/api/admin/ai/probe-stats/reset')
        const r2 = await request(buildApp({ session: adminSession })).post('/api/admin/ai/probe-stats/reset')
        expect(r2.status).toBe(204)
        expect(mockReset).toHaveBeenCalledTimes(2)
    })

    it('returns 403 for a non-admin', async () => {
        const res = await request(buildApp({
            session: { accessToken: 'tok', userId: 1, tier: 'enterprise', isAdmin: false },
        })).post('/api/admin/ai/probe-stats/reset')
        expect(res.status).toBe(403)
        expect(mockReset).not.toHaveBeenCalled()
    })
})
