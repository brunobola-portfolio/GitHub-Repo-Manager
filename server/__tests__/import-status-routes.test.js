// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// GET /migrations binds `page` and `per_page` straight into `LIMIT ? OFFSET ?`.
// A negative LIMIT is "no limit" in SQLite and a NaN binds as NULL, which it
// reads the same way — so before the clamp `?per_page=-1` and `?per_page=abc`
// returned every migration_jobs row the user had ever created, and `?page=-5`
// produced a negative OFFSET. These tests read the bound parameters directly.

const boundParams = []

const listStmt = {
    all: (...args) => { boundParams.push(args); return [] },
}
const countStmt = { get: () => ({ count: 0 }) }

vi.mock('../db.js', () => ({
    default: {
        prepare: (sql) => (/COUNT\(\*\)/.test(sql) ? countStmt : listStmt),
    },
}))

vi.mock('../import-service.js', () => ({ checkGitInstalled: vi.fn() }))

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: (req, _res, next) => { req.session = { userId: 7 }; next() },
}))

const { default: statusRouter } = await import('../routes/import/status.js')

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/v1', statusRouter)
    return app
}

// [userId, perPage, offset]
function lastBinding() {
    return boundParams[boundParams.length - 1]
}

beforeEach(() => {
    boundParams.length = 0
})

describe('GET /migrations pagination clamps', () => {
    const cases = [
        { query: 'per_page=-1', perPage: 1, offset: 0 },
        { query: 'per_page=abc', perPage: 20, offset: 0 },
        { query: 'per_page=0', perPage: 20, offset: 0 },
        { query: 'per_page=100000', perPage: 100, offset: 0 },
        { query: 'page=-5', perPage: 20, offset: 0 },
        { query: 'page=abc', perPage: 20, offset: 0 },
        { query: 'page=3&per_page=10', perPage: 10, offset: 20 },
    ]

    for (const { query, perPage, offset } of cases) {
        it(`?${query} binds a positive, bounded LIMIT/OFFSET`, async () => {
            const res = await request(makeApp()).get(`/api/v1/migrations?${query}`)
            expect(res.status).toBe(200)

            const [, boundLimit, boundOffset] = lastBinding()
            expect(Number.isInteger(boundLimit)).toBe(true)
            expect(Number.isInteger(boundOffset)).toBe(true)
            expect(boundLimit).toBe(perPage)
            expect(boundOffset).toBe(offset)
            expect(boundLimit).toBeGreaterThan(0)
            expect(boundLimit).toBeLessThanOrEqual(100)
            expect(boundOffset).toBeGreaterThanOrEqual(0)
        })
    }
})
