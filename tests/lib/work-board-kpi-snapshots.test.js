// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

// Set up an in-memory DB and mock the global db module before importing target
const testDb = new Database(':memory:')
testDb.exec(`
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL
    );
    CREATE TABLE work_board_kpi_snapshots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        snapped_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviews     INTEGER NOT NULL DEFAULT 0,
        stale_prs   INTEGER NOT NULL DEFAULT 0,
        issues      INTEGER NOT NULL DEFAULT 0,
        tech_debt   INTEGER NOT NULL DEFAULT 0
    );
`)
testDb.exec(`INSERT INTO users (id, username) VALUES (1, 'alice')`)

vi.mock('../../server/lib/event-aggregations.js', () => ({
    listMyPendingReviews: vi.fn().mockReturnValue([{ id: 1 }, { id: 2 }]),
    listStalePRs: vi.fn().mockReturnValue([{ id: 1 }]),
    listMyOpenIssues: vi.fn().mockReturnValue([{ id: 1 }, { id: 2 }, { id: 3 }]),
    listTechDebtIssues: vi.fn().mockReturnValue([{ id: 1 }]),
}))

const { writeSnapshot, getSnapshots, pruneSnapshots } =
    await import('../../server/lib/work-board-kpi-snapshots.js')

describe('writeSnapshot', () => {
    beforeEach(() => {
        testDb.exec('DELETE FROM work_board_kpi_snapshots')
    })

    it('inserts a snapshot row and returns { inserted: true }', () => {
        const result = writeSnapshot(testDb, 1)
        expect(result).toEqual({ inserted: true })
        const rows = testDb.prepare('SELECT * FROM work_board_kpi_snapshots').all()
        expect(rows).toHaveLength(1)
        expect(rows[0].reviews).toBe(2)
        expect(rows[0].stale_prs).toBe(1)
        expect(rows[0].issues).toBe(3)
        expect(rows[0].tech_debt).toBe(1)
    })

    it('skips duplicate write for the same UTC day and returns { inserted: false }', () => {
        writeSnapshot(testDb, 1)
        const result = writeSnapshot(testDb, 1)
        expect(result).toEqual({ inserted: false })
        const rows = testDb.prepare('SELECT * FROM work_board_kpi_snapshots').all()
        expect(rows).toHaveLength(1)
    })
})

describe('getSnapshots', () => {
    beforeEach(() => {
        testDb.exec('DELETE FROM work_board_kpi_snapshots')
        // Insert 3 rows at different "days" using explicit snapped_at
        testDb.exec(`
            INSERT INTO work_board_kpi_snapshots (user_id, snapped_at, reviews, stale_prs, issues, tech_debt)
            VALUES
              (1, datetime('now', '-6 days'), 1, 2, 3, 4),
              (1, datetime('now', '-3 days'), 2, 3, 4, 5),
              (1, datetime('now', '-0 days'), 3, 4, 5, 6)
        `)
    })

    it('returns rows ordered snapped_at ASC', () => {
        const rows = getSnapshots(testDb, 1, 7)
        expect(rows).toHaveLength(3)
        expect(rows[0].reviews).toBe(1)
        expect(rows[2].reviews).toBe(3)
    })

    it('respects the days window', () => {
        const rows = getSnapshots(testDb, 1, 2)
        expect(rows).toHaveLength(1)
    })

    it('returns empty array for unknown user', () => {
        expect(getSnapshots(testDb, 999, 7)).toEqual([])
    })
})

describe('pruneSnapshots', () => {
    beforeEach(() => {
        testDb.exec('DELETE FROM work_board_kpi_snapshots')
        testDb.exec(`
            INSERT INTO work_board_kpi_snapshots (user_id, snapped_at, reviews, stale_prs, issues, tech_debt)
            VALUES
              (1, datetime('now', '-100 days'), 0, 0, 0, 0),
              (1, datetime('now', '-50 days'),  0, 0, 0, 0),
              (1, datetime('now', '-1 days'),   0, 0, 0, 0)
        `)
    })

    it('deletes rows older than retentionDays and returns the count', () => {
        const deleted = pruneSnapshots(testDb, 90)
        expect(deleted).toBe(1)
        const remaining = testDb.prepare('SELECT COUNT(*) as c FROM work_board_kpi_snapshots').get()
        expect(remaining.c).toBe(2)
    })

    it('deletes nothing when all rows are within the window', () => {
        expect(pruneSnapshots(testDb, 200)).toBe(0)
    })
})
