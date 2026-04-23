// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted, so all factory code runs before module imports.
// We create the in-memory DB inside the factory so testDb is always ready.
// ---------------------------------------------------------------------------

// Shared db instance — created lazily inside the mock factory below.
// We export it from the mock so tests can inspect it.
let _testDb

vi.mock('../db.js', async () => {
    const Database = (await import('better-sqlite3')).default
    const { initDB } = await vi.importActual('../db.js')
    const db = new Database(':memory:')
    initDB(db)

    db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(1, 'alice')
    db.exec(`
        INSERT INTO work_board_kpi_snapshots (user_id, snapped_at, reviews, stale_prs, issues, tech_debt)
        VALUES
          (1, datetime('now', '-6 days'), 1, 2, 3, 4),
          (1, datetime('now', '-3 days'), 2, 3, 4, 5),
          (1, datetime('now'),            3, 4, 5, 6)
    `)

    _testDb = db
    return { default: db, initDB: () => {}, seedMockData: () => {} }
})

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

vi.mock('../lib/work-board-cache.js', () => ({
    getCached: vi.fn(() => null),
    putCached: vi.fn(),
    invalidate: vi.fn(),
    purgeExpired: vi.fn(),
}))

vi.mock('../lib/work-board-github.js', () => ({
    fetchMyPendingReviews: vi.fn(async () => ({ items: [] })),
    fetchStalePRs: vi.fn(async () => ({ items: [] })),
    fetchMyOpenIssues: vi.fn(async () => ({ items: [] })),
    fetchTechDebtIssues: vi.fn(async () => ({ items: [] })),
    DEFAULT_DEBT_LABELS: [],
}))

vi.mock('../lib/work-board-snooze.js', () => ({
    filterOutSnoozed: vi.fn(({ items }) => items),
    snooze: vi.fn(),
    unsnooze: vi.fn(),
    isSnoozed: vi.fn(),
    listSnoozes: vi.fn(),
    purgeExpiredSnoozes: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => {
        req.session = { userId: 1, userLogin: 'alice', accessToken: 'tok' }
        next()
    },
    errorResponse: (res, status, message) => res.status(status).json({ error: message }),
    safeError: (_err, fallback) => fallback,
}))

vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_req, _res, next) => next(),
}))

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Build minimal test app (after mocks are in place)
// ---------------------------------------------------------------------------
const { default: workBoardRouter } = await import('../routes/work-board.js')

const app = express()
app.use(express.json())
app.use('/api/v1/work-board', workBoardRouter)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /api/v1/work-board/kpi-snapshots', () => {
    it('returns 200 with data array for authenticated user', async () => {
        const res = await request(app)
            .get('/api/v1/work-board/kpi-snapshots?days=7')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body.data)).toBe(true)
        expect(res.body.data).toHaveLength(3)
        expect(res.body.data[0]).toHaveProperty('snappedAt')
        expect(res.body.data[0]).toHaveProperty('reviews')
    })

    it('clamps days to 30 maximum and returns all 3 rows (all within 30 days)', async () => {
        const res = await request(app)
            .get('/api/v1/work-board/kpi-snapshots?days=999')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body.data)).toBe(true)
        expect(res.body.data).toHaveLength(3)
    })

    it('defaults to 7 days when days param is missing and returns all 3 seeded rows', async () => {
        const res = await request(app)
            .get('/api/v1/work-board/kpi-snapshots')
        expect(res.status).toBe(200)
        expect(Array.isArray(res.body.data)).toBe(true)
        expect(res.body.data).toHaveLength(3)
    })
})
