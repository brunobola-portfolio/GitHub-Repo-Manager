import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockDigest = vi.fn()
const mockMarkSeen = vi.fn()
vi.mock('../lib/notifications-digest.js', () => ({
    buildNotificationsDigest: (...a) => mockDigest(...a),
    markNotificationsSeen: (...a) => mockMarkSeen(...a),
}))

const dbGet = vi.fn(() => ({ username: 'alice', notifications_last_seen_at: '2026-04-25T10:00:00Z' }))
vi.mock('../db.js', () => ({
    default: {
        prepare: () => ({ get: dbGet, all: vi.fn(() => []), run: vi.fn(() => ({ changes: 1 })) }),
        transaction: (fn) => fn,
    },
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

const { default: notificationsRouter } = await import('../routes/notifications.js')

function buildApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'tok', userId: 1 }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/notifications', notificationsRouter)
    return app
}

describe('GET /api/notifications/digest', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        dbGet.mockReturnValue({ username: 'alice', notifications_last_seen_at: '2026-04-25T10:00:00Z' })
    })

    it('returns the digest payload from the aggregator', async () => {
        const sample = {
            since: '2026-04-25T10:00:00Z',
            now: '2026-04-26T12:00:00Z',
            totals: { reviews: 1, issues: 0, failed_migrations: 0, stale_pinned: 0 },
            items: { reviews: [{ repo: 'a/b', prNumber: 1, title: 'T', since: '2026-04-26T11:00:00Z' }], issues: [], failed_migrations: [], stale_pinned: [] },
        }
        mockDigest.mockReturnValue(sample)
        const res = await request(buildApp()).get('/api/notifications/digest')
        expect(res.status).toBe(200)
        expect(res.body).toEqual(sample)
        // Aggregator gets the user id + login + last_seen.
        expect(mockDigest).toHaveBeenCalledWith(1, expect.objectContaining({
            login: 'alice',
            last_seen_at: '2026-04-25T10:00:00Z',
        }))
    })

    it('returns 401 without an authenticated session', async () => {
        const app = express()
        app.use(express.json())
        app.use((req, _res, next) => { req.session = {}; req.log = { error: vi.fn() }; next() })
        app.use('/api/notifications', notificationsRouter)
        const res = await request(app).get('/api/notifications/digest')
        expect(res.status).toBe(401)
    })

    it('handles a missing user row by passing nullish login + last_seen', async () => {
        dbGet.mockReturnValue(undefined)
        mockDigest.mockReturnValue({
            since: 'x', now: 'y',
            totals: { reviews: 0, issues: 0, failed_migrations: 0, stale_pinned: 0 },
            items: { reviews: [], issues: [], failed_migrations: [], stale_pinned: [] },
        })
        const res = await request(buildApp()).get('/api/notifications/digest')
        expect(res.status).toBe(200)
        expect(mockDigest).toHaveBeenCalledWith(1, expect.objectContaining({
            login: null,
            last_seen_at: null,
        }))
    })
})

describe('POST /api/notifications/mark-seen', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns 204 and calls markNotificationsSeen with the session user id', async () => {
        const res = await request(buildApp()).post('/api/notifications/mark-seen')
        expect(res.status).toBe(204)
        expect(mockMarkSeen).toHaveBeenCalledWith(1)
    })

    it('is idempotent — second call also returns 204', async () => {
        await request(buildApp()).post('/api/notifications/mark-seen')
        const res = await request(buildApp()).post('/api/notifications/mark-seen')
        expect(res.status).toBe(204)
        expect(mockMarkSeen).toHaveBeenCalledTimes(2)
    })
})
