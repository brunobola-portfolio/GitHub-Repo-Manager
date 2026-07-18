// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })),
        transaction: (fn) => fn,
    },
}))
vi.mock('../lib/gh-cache.js', () => ({ readThrough: vi.fn() }))
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
        next()
    },
    isValidGitHubUsername: () => true,
    safeError: (_err, fallback) => fallback,
    errorResponse: (res, status, message, code = null) =>
        res.status(status).json({ error: message, ...(code && { code }) }),
}))

import { readThrough } from '../lib/gh-cache.js'

describe('GET /:owner/:repo/readme — read-through cache wiring', () => {
    let app

    beforeEach(async () => {
        vi.clearAllMocks()
        app = express()
        app.use((req, _res, next) => {
            req.session = { accessToken: 'tok', userId: 7, user: { login: 'alice' } }
            req.log = { error: vi.fn() }
            next()
        })
        const { default: router } = await import('../routes/repos/crud.js')
        app.use('/repos', router)
    })

    it('reads through gh-cache with the right resource key/type and forwards stale headers', async () => {
        readThrough.mockResolvedValue({
            data: { content: 'aGVsbG8=', encoding: 'base64' },
            fromCache: true,
            stale: true,
            fetchedAt: '2026-07-17 12:00:00',
        })

        const res = await request(app).get('/repos/alice/hello/readme')

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ content: 'aGVsbG8=', encoding: 'base64' })
        expect(res.headers['x-cache']).toBe('stale')
        expect(res.headers['x-cache-fetched-at']).toBe('2026-07-17 12:00:00')
        expect(readThrough).toHaveBeenCalledWith(expect.objectContaining({
            userId: 7,
            resourceType: 'readme',
            resourceKey: 'alice/hello',
            ttlMs: 10 * 60 * 1000,
            fetcher: expect.any(Function),
        }))
    })

    it('omits X-Cache when the read is fresh (not served from stale cache)', async () => {
        readThrough.mockResolvedValue({
            data: { content: 'aGVsbG8=' },
            fromCache: false,
            stale: false,
            fetchedAt: '2026-07-17 12:05:00',
        })

        const res = await request(app).get('/repos/alice/hello/readme')

        expect(res.status).toBe(200)
        expect(res.headers['x-cache']).toBeUndefined()
        expect(res.headers['x-cache-fetched-at']).toBe('2026-07-17 12:05:00')
    })

    it('maps a 404 (no README) to { exists: false } instead of an error response', async () => {
        const err = new Error('Not Found')
        err.status = 404
        readThrough.mockRejectedValue(err)

        const res = await request(app).get('/repos/alice/hello/readme')

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ exists: false })
    })

    it('propagates a non-404 failure (cold cache + GitHub down) as an error response', async () => {
        const err = new Error('boom')
        err.status = 502
        readThrough.mockRejectedValue(err)

        const res = await request(app).get('/repos/alice/hello/readme')

        expect(res.status).toBe(502)
        expect(res.body.error).toBeTruthy()
    })
})
