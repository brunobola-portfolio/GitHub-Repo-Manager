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
const dbRun = vi.fn(() => ({ changes: 1 }))
vi.mock('../db.js', () => ({
    default: {
        prepare: () => ({ get: dbGet, all: vi.fn(() => []), run: (...a) => dbRun(...a) }),
        transaction: (fn) => fn,
    },
}))

const mockVerifyUnsubscribeToken = vi.fn(() => null)
vi.mock('../lib/digest-unsubscribe-token.js', () => ({
    verifyUnsubscribeToken: (...a) => mockVerifyUnsubscribeToken(...a),
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

describe('GET /api/notifications/digest/settings (G7)', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('returns the stored frequency', async () => {
        dbGet.mockReturnValue({ digest_frequency: 'weekly' })
        const res = await request(buildApp()).get('/api/notifications/digest/settings')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ frequency: 'weekly' })
    })

    it('defaults to "off" when the row has no value', async () => {
        dbGet.mockReturnValue({ digest_frequency: null })
        const res = await request(buildApp()).get('/api/notifications/digest/settings')
        expect(res.body).toEqual({ frequency: 'off' })
    })

    it('requires an authenticated session', async () => {
        const app = express()
        app.use(express.json())
        app.use((req, _res, next) => { req.session = {}; req.log = { error: vi.fn() }; next() })
        app.use('/api/notifications', notificationsRouter)
        const res = await request(app).get('/api/notifications/digest/settings')
        expect(res.status).toBe(401)
    })
})

describe('PATCH /api/notifications/digest/settings (G7)', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('updates the frequency and returns it', async () => {
        const res = await request(buildApp()).patch('/api/notifications/digest/settings').send({ frequency: 'daily' })
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ frequency: 'daily' })
        expect(dbRun).toHaveBeenCalledWith('daily', 1)
    })

    it('rejects an invalid frequency without touching the database', async () => {
        const res = await request(buildApp()).patch('/api/notifications/digest/settings').send({ frequency: 'hourly' })
        expect(res.status).toBe(400)
        expect(dbRun).not.toHaveBeenCalled()
    })

    it('rejects a missing frequency', async () => {
        const res = await request(buildApp()).patch('/api/notifications/digest/settings').send({})
        expect(res.status).toBe(400)
    })
})

describe('GET /api/notifications/digest/unsubscribe (G7)', () => {
    beforeEach(() => { vi.clearAllMocks() })

    // Deliberately session-free: no requireAuth session is seeded on this app,
    // proving the route works without one — the whole point of the token.
    function buildUnauthedApp() {
        const app = express()
        app.use(express.json())
        app.use((req, _res, next) => { req.log = { error: vi.fn() }; next() })
        app.use('/api/notifications', notificationsRouter)
        return app
    }

    it('turns digest_frequency off for the token\'s user with no session required', async () => {
        mockVerifyUnsubscribeToken.mockReturnValue(42)
        const res = await request(buildUnauthedApp()).get('/api/notifications/digest/unsubscribe?token=good-token')
        expect(res.status).toBe(200)
        expect(res.text).toMatch(/unsubscribed/i)
        expect(dbRun).toHaveBeenCalledWith(42)
    })

    it('rejects an invalid or missing token without touching the database', async () => {
        mockVerifyUnsubscribeToken.mockReturnValue(null)
        const res = await request(buildUnauthedApp()).get('/api/notifications/digest/unsubscribe?token=bad')
        expect(res.status).toBe(400)
        expect(res.text).toMatch(/invalid/i)
        expect(dbRun).not.toHaveBeenCalled()
    })

    it('round-trips: settings reflect "off" immediately after unsubscribing', async () => {
        mockVerifyUnsubscribeToken.mockReturnValue(42)
        await request(buildUnauthedApp()).get('/api/notifications/digest/unsubscribe?token=good-token')
        dbGet.mockReturnValue({ digest_frequency: 'off' })
        const res = await request(buildApp()).get('/api/notifications/digest/settings')
        expect(res.body).toEqual({ frequency: 'off' })
    })
})
