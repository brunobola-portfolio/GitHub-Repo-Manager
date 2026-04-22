// @vitest-environment node
/**
 * K8s-style liveness + readiness probe tests.
 *
 *   /api/health/live   — shallow: process is up → 200 { status: 'alive' }
 *   /api/health/ready  — deep: DB + session store → 200 or 503 with
 *                        per-dependency breakdown
 *
 * We mock db.js and config.js so we can flip the "DB throws" case and
 * the "REDIS_URL set" case without touching real infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mutable mock state — reset in beforeEach
const mockState = {
    dbThrows: false,
    redisUrl: undefined,
}

vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn((_sql) => ({
            get: vi.fn(() => {
                if (mockState.dbThrows) {
                    throw new Error('database is locked')
                }
                return { ok: 1 }
            }),
            all: vi.fn(() => []),
            run: vi.fn(),
        })),
    },
}))

vi.mock('../config.js', () => ({
    config: new Proxy({}, {
        get(_t, prop) {
            if (prop === 'redisUrl') return mockState.redisUrl
            return undefined
        },
    }),
}))

const { default: healthRouter, __resetShuttingDownForTests, markShuttingDown } =
    await import('../routes/health.js')

function buildApp() {
    const app = express()
    app.use('/api/health', healthRouter)
    return app
}

describe('GET /api/health/live', () => {
    beforeEach(() => {
        mockState.dbThrows = false
        mockState.redisUrl = undefined
        __resetShuttingDownForTests()
    })

    it('returns 200 { status: "alive" } when the process is up', async () => {
        const res = await request(buildApp()).get('/api/health/live')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ status: 'alive' })
    })

    it('returns 503 { status: "shutting_down" } once graceful shutdown has started', async () => {
        markShuttingDown()
        const res = await request(buildApp()).get('/api/health/live')
        expect(res.status).toBe(503)
        expect(res.body).toEqual({ status: 'shutting_down' })
    })

    it('does NOT touch the DB (still 200 even when DB would throw)', async () => {
        // Liveness must isolate the "is this process alive" signal from any
        // downstream dependency — otherwise a DB blip would tell the
        // orchestrator to kill the pod.
        mockState.dbThrows = true
        const res = await request(buildApp()).get('/api/health/live')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ status: 'alive' })
    })
})

describe('GET /api/health/ready', () => {
    beforeEach(() => {
        mockState.dbThrows = false
        mockState.redisUrl = undefined
        __resetShuttingDownForTests()
    })

    it('returns 200 { status: "ready", checks: { db: "ok", session: "ok" } } when healthy', async () => {
        const res = await request(buildApp()).get('/api/health/ready')
        expect(res.status).toBe(200)
        expect(res.body.status).toBe('ready')
        expect(res.body.checks).toEqual({ db: 'ok', session: 'ok' })
    })

    it('returns 503 { status: "degraded", checks: { db: "error: ..." } } when the DB throws', async () => {
        mockState.dbThrows = true
        const res = await request(buildApp()).get('/api/health/ready')
        expect(res.status).toBe(503)
        expect(res.body.status).toBe('degraded')
        expect(res.body.checks.db).toMatch(/^error: /)
        // Message from the thrown error should be surfaced (helps on-call)
        expect(res.body.checks.db).toContain('database is locked')
    })
})
