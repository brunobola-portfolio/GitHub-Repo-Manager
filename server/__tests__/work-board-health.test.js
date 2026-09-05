// @vitest-environment node
/**
 * G9 — server/lib/work-board-health.js: snapshot history, week-over-week
 * delta, failing-check extraction, and the background capture pass that
 * turns an already-cached community-health score into a history point.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
    getLatestSnapshot,
    isSnapshotFresh,
    captureHealthSnapshot,
    getWeekOverWeekDelta,
    failingChecksFromRecommendations,
    runHealthSnapshotCaptureOnce,
} from '../lib/work-board-health.js'

function makeDb() {
    const db = new Database(':memory:')
    db.exec(`
        CREATE TABLE work_board_health_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            repo_full_name TEXT NOT NULL, score INTEGER NOT NULL,
            failing_checks TEXT NOT NULL DEFAULT '[]',
            captured_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE work_board_tracked_repos (
            user_id INTEGER NOT NULL, repo_full_name TEXT NOT NULL, repo_id INTEGER
        );
        CREATE TABLE community_health_cache (
            user_id INTEGER NOT NULL, repo_id INTEGER NOT NULL,
            health_score INTEGER, recommendations TEXT
        );
    `)
    return db
}

describe('captureHealthSnapshot + getLatestSnapshot', () => {
    let db
    beforeEach(() => { db = makeDb() })

    it('round-trips a snapshot', () => {
        captureHealthSnapshot(1, 'acme/backend', 82, ['Add SECURITY.md'], db)
        const row = getLatestSnapshot(1, 'acme/backend', db)
        expect(row.score).toBe(82)
        expect(JSON.parse(row.failing_checks)).toEqual(['Add SECURITY.md'])
    })

    it('returns null when there is no snapshot yet', () => {
        expect(getLatestSnapshot(1, 'acme/none', db)).toBeNull()
    })

    it('returns the most recent snapshot when several exist', () => {
        db.prepare(`INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score, captured_at) VALUES (1, 'acme/backend', 70, '2026-08-01T00:00:00Z')`).run()
        db.prepare(`INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score, captured_at) VALUES (1, 'acme/backend', 85, '2026-08-10T00:00:00Z')`).run()
        expect(getLatestSnapshot(1, 'acme/backend', db).score).toBe(85)
    })
})

describe('isSnapshotFresh', () => {
    it('is false for null', () => {
        expect(isSnapshotFresh(null)).toBe(false)
    })

    it('is true within 24h, false beyond it', () => {
        const now = Date.parse('2026-09-05T12:00:00Z')
        expect(isSnapshotFresh({ captured_at: '2026-09-05T00:01:00Z' }, now)).toBe(true)
        expect(isSnapshotFresh({ captured_at: '2026-09-04T11:00:00Z' }, now)).toBe(false)
    })
})

describe('getWeekOverWeekDelta', () => {
    let db
    beforeEach(() => { db = makeDb() })

    it('returns null with fewer than two snapshots', () => {
        captureHealthSnapshot(1, 'acme/backend', 80, [], db)
        expect(getWeekOverWeekDelta(1, 'acme/backend', { database: db })).toBeNull()
    })

    it('compares the latest score against the point closest to 7 days ago', () => {
        const now = Date.parse('2026-09-05T00:00:00Z')
        const ins = db.prepare(`INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score, captured_at) VALUES (1, 'acme/backend', ?, ?)`)
        ins.run(60, '2026-08-20T00:00:00Z') // 16 days ago — too old, not the baseline
        ins.run(70, '2026-08-29T00:00:00Z') // 7 days ago — closest to the lookback window
        ins.run(85, '2026-09-05T00:00:00Z') // latest (today)
        expect(getWeekOverWeekDelta(1, 'acme/backend', { database: db, now })).toBe(15)
    })

    it('falls back to the oldest snapshot when history is younger than 7 days', () => {
        const now = Date.parse('2026-09-05T00:00:00Z')
        const ins = db.prepare(`INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score, captured_at) VALUES (1, 'acme/backend', ?, ?)`)
        ins.run(50, '2026-09-03T00:00:00Z')
        ins.run(60, '2026-09-05T00:00:00Z')
        expect(getWeekOverWeekDelta(1, 'acme/backend', { database: db, now })).toBe(10)
    })

    it('scopes to the given user and repo', () => {
        const ins = db.prepare(`INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score, captured_at) VALUES (?, ?, ?, ?)`)
        ins.run(1, 'acme/backend', 50, '2026-08-01T00:00:00Z')
        ins.run(1, 'acme/backend', 60, '2026-09-01T00:00:00Z')
        ins.run(2, 'acme/backend', 99, '2026-08-01T00:00:00Z') // another tenant, same repo name
        expect(getWeekOverWeekDelta(2, 'acme/backend', { database: db })).toBeNull()
    })
})

describe('failingChecksFromRecommendations', () => {
    it('keeps only high-priority recommendations, mapped to their action text', () => {
        const recs = [
            { priority: 'high', action: 'Add a LICENSE file' },
            { priority: 'medium', action: 'Improve README' },
            { priority: 'low', action: 'Add PR template' },
            { priority: 'high', action: 'Add SECURITY.md' },
        ]
        expect(failingChecksFromRecommendations(recs)).toEqual(['Add a LICENSE file', 'Add SECURITY.md'])
    })

    it('handles missing/malformed input', () => {
        expect(failingChecksFromRecommendations()).toEqual([])
        expect(failingChecksFromRecommendations(null)).toEqual([])
        expect(failingChecksFromRecommendations([{ priority: 'high' }])).toEqual([]) // no action text
    })
})

describe('runHealthSnapshotCaptureOnce', () => {
    let db
    beforeEach(() => { db = makeDb() })

    it('captures a snapshot for a tracked repo with a cached score and no prior snapshot', () => {
        db.prepare(`INSERT INTO work_board_tracked_repos (user_id, repo_full_name, repo_id) VALUES (1, 'acme/backend', 100)`).run()
        db.prepare(`INSERT INTO community_health_cache (user_id, repo_id, health_score, recommendations) VALUES (1, 100, 78, ?)`)
            .run(JSON.stringify([{ priority: 'high', action: 'Add LICENSE' }]))

        const summary = runHealthSnapshotCaptureOnce({ database: db })
        expect(summary).toEqual({ captured: 1, skipped: 0, total: 1 })

        const snap = getLatestSnapshot(1, 'acme/backend', db)
        expect(snap.score).toBe(78)
        expect(JSON.parse(snap.failing_checks)).toEqual(['Add LICENSE'])
    })

    it('skips a repo already snapshotted within the last 24h', () => {
        db.prepare(`INSERT INTO work_board_tracked_repos (user_id, repo_full_name, repo_id) VALUES (1, 'acme/backend', 100)`).run()
        db.prepare(`INSERT INTO community_health_cache (user_id, repo_id, health_score, recommendations) VALUES (1, 100, 78, '[]')`).run()
        captureHealthSnapshot(1, 'acme/backend', 78, [], db) // "just captured"

        const summary = runHealthSnapshotCaptureOnce({ database: db })
        expect(summary).toEqual({ captured: 0, skipped: 1, total: 1 })
    })

    it('ignores tracked repos with no cached health analysis yet', () => {
        db.prepare(`INSERT INTO work_board_tracked_repos (user_id, repo_full_name, repo_id) VALUES (1, 'acme/never-checked', 200)`).run()
        const summary = runHealthSnapshotCaptureOnce({ database: db })
        expect(summary).toEqual({ captured: 0, skipped: 0, total: 0 })
    })

    it('ignores tracked repos with a null repo_id (never synced)', () => {
        db.prepare(`INSERT INTO work_board_tracked_repos (user_id, repo_full_name, repo_id) VALUES (1, 'acme/pinned-only', NULL)`).run()
        const summary = runHealthSnapshotCaptureOnce({ database: db })
        expect(summary.total).toBe(0)
    })

    it('is bounded by maxRepos', () => {
        for (let i = 0; i < 5; i++) {
            db.prepare(`INSERT INTO work_board_tracked_repos (user_id, repo_full_name, repo_id) VALUES (1, ?, ?)`).run(`acme/repo-${i}`, i)
            db.prepare(`INSERT INTO community_health_cache (user_id, repo_id, health_score, recommendations) VALUES (1, ?, 80, '[]')`).run(i)
        }
        const summary = runHealthSnapshotCaptureOnce({ database: db, maxRepos: 2 })
        expect(summary.total).toBe(2)
    })
})
