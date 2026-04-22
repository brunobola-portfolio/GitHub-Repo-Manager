// @vitest-environment node
/**
 * sessionAbsoluteTimeout middleware tests.
 *
 * The middleware enforces a 7-day ceiling on every session, regardless of
 * the rolling 24h cookie expiry. We test it directly with mocked req/res
 * so we can control req.session.createdAt without wrestling a real session
 * store.
 */

import { describe, it, expect, vi } from 'vitest'
import {
    sessionAbsoluteTimeout,
    ABSOLUTE_TIMEOUT_MS,
} from '../middleware/session-absolute-timeout.js'

function makeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this },
        json(payload) { this.body = payload; return this },
    }
}

describe('sessionAbsoluteTimeout', () => {
    it('ABSOLUTE_TIMEOUT_MS is 7 days', () => {
        expect(ABSOLUTE_TIMEOUT_MS).toBe(7 * 24 * 3600 * 1000)
    })

    it('calls next() when createdAt = now', () => {
        const req = { session: { createdAt: Date.now(), destroy: vi.fn() } }
        const res = makeRes()
        const next = vi.fn()
        sessionAbsoluteTimeout(req, res, next)
        expect(next).toHaveBeenCalledTimes(1)
        expect(req.session.destroy).not.toHaveBeenCalled()
        expect(res.statusCode).toBe(200)
    })

    it('calls next() when createdAt is 6 days old (well inside the window)', () => {
        const req = {
            session: {
                createdAt: Date.now() - 6 * 24 * 3600 * 1000,
                destroy: vi.fn(),
            },
        }
        const res = makeRes()
        const next = vi.fn()
        sessionAbsoluteTimeout(req, res, next)
        expect(next).toHaveBeenCalledTimes(1)
        expect(req.session.destroy).not.toHaveBeenCalled()
    })

    it('destroys the session and returns 401 when createdAt = now - 7 days - 1 second', () => {
        const destroy = vi.fn((cb) => cb && cb())
        const req = {
            session: {
                createdAt: Date.now() - (ABSOLUTE_TIMEOUT_MS + 1000),
                destroy,
            },
        }
        const res = makeRes()
        const next = vi.fn()
        sessionAbsoluteTimeout(req, res, next)

        expect(destroy).toHaveBeenCalledTimes(1)
        expect(next).not.toHaveBeenCalled()
        expect(res.statusCode).toBe(401)
        expect(res.body).toMatchObject({ code: 'session_absolute_timeout' })
    })

    it('accepts legacy sessions missing createdAt and calls next()', () => {
        const req = { session: { userId: 42, destroy: vi.fn() } } // no createdAt
        const res = makeRes()
        const next = vi.fn()
        sessionAbsoluteTimeout(req, res, next)
        expect(next).toHaveBeenCalledTimes(1)
        expect(req.session.destroy).not.toHaveBeenCalled()
        expect(res.statusCode).toBe(200)
    })

    it('no-ops when there is no session at all', () => {
        const req = {} // no session (e.g. unauth route before session middleware)
        const res = makeRes()
        const next = vi.fn()
        sessionAbsoluteTimeout(req, res, next)
        expect(next).toHaveBeenCalledTimes(1)
        expect(res.statusCode).toBe(200)
    })

    it('reports session.destroy errors via req.log.error but still responds 401', () => {
        const destroy = vi.fn((cb) => cb && cb(new Error('store unavailable')))
        const errorLog = vi.fn()
        const req = {
            log: { error: errorLog },
            session: {
                createdAt: Date.now() - (ABSOLUTE_TIMEOUT_MS + 1000),
                destroy,
            },
        }
        const res = makeRes()
        const next = vi.fn()
        sessionAbsoluteTimeout(req, res, next)
        expect(errorLog).toHaveBeenCalledTimes(1)
        expect(res.statusCode).toBe(401)
    })

    it('backfills createdAt on a legacy session when login stamps it (contract doc)', () => {
        // Conceptual test: a legacy session without createdAt passes through,
        // and the NEXT login stamps createdAt to "now", after which the
        // middleware enforces the full 7-day window from that stamp.
        const req = { session: {} } // legacy — no createdAt
        const res = makeRes()
        const next = vi.fn()
        sessionAbsoluteTimeout(req, res, next)
        expect(next).toHaveBeenCalledTimes(1)

        // Simulate the login flow stamping createdAt (what auth.js does).
        req.session.createdAt = Date.now()

        // Re-run the middleware — the freshly-stamped session passes.
        const res2 = makeRes()
        const next2 = vi.fn()
        sessionAbsoluteTimeout(req, res2, next2)
        expect(next2).toHaveBeenCalledTimes(1)
        expect(res2.statusCode).toBe(200)
    })
})
