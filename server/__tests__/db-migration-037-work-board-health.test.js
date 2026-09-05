// @vitest-environment node
/**
 * G9 — migration 37 adds work_board_health_snapshots, an append-only history
 * table backing the Work Board's Health tab (score + failing checks + a
 * week-over-week delta). Distinct from community_health_cache, which only
 * ever holds the latest score (ON CONFLICT UPDATE overwrites it).
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATIONS } from '../lib/db-migrations.js'

const migration = (v) => MIGRATIONS.find((m) => m.version === v)

function seedUsersTable() {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL)`)
    db.prepare('INSERT INTO users (id, username) VALUES (1, ?)').run('alice')
    return db
}

describe('migration 37 — work_board_health_snapshots', () => {
    it('is registered right after 36, keeping versions contiguous', () => {
        expect(migration(37)).toBeDefined()
        const versions = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b)
        for (let i = 1; i < versions.length; i++) expect(versions[i]).toBe(versions[i - 1] + 1)
    })

    it('creates the table with the expected columns and default', () => {
        const db = seedUsersTable()
        migration(37).up(db)
        db.prepare(`INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score, failing_checks)
            VALUES (1, 'acme/backend', 82, ?)`).run(JSON.stringify(['missing SECURITY.md']))
        const row = db.prepare('SELECT * FROM work_board_health_snapshots WHERE user_id = 1').get()
        expect(row.repo_full_name).toBe('acme/backend')
        expect(row.score).toBe(82)
        expect(JSON.parse(row.failing_checks)).toEqual(['missing SECURITY.md'])
        expect(row.captured_at).toBeTruthy()
    })

    it('defaults failing_checks to an empty array when omitted', () => {
        const db = seedUsersTable()
        migration(37).up(db)
        db.prepare(`INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score) VALUES (1, 'acme/frontend', 91)`).run()
        const row = db.prepare('SELECT failing_checks FROM work_board_health_snapshots WHERE repo_full_name = ?').get('acme/frontend')
        expect(JSON.parse(row.failing_checks)).toEqual([])
    })

    it('allows multiple snapshots per repo over time (append-only history)', () => {
        const db = seedUsersTable()
        migration(37).up(db)
        const ins = db.prepare(`INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score, captured_at) VALUES (1, 'acme/backend', ?, ?)`)
        ins.run(70, '2026-08-25T00:00:00Z')
        ins.run(82, '2026-09-01T00:00:00Z')
        const rows = db.prepare('SELECT score FROM work_board_health_snapshots WHERE repo_full_name = ? ORDER BY captured_at').all('acme/backend')
        expect(rows.map(r => r.score)).toEqual([70, 82])
    })

    it('is idempotent — a second run does not error or drop existing rows', () => {
        const db = seedUsersTable()
        migration(37).up(db)
        db.prepare(`INSERT INTO work_board_health_snapshots (user_id, repo_full_name, score) VALUES (1, 'acme/backend', 82)`).run()
        expect(() => migration(37).up(db)).not.toThrow()
        const count = db.prepare('SELECT COUNT(*) AS c FROM work_board_health_snapshots').get().c
        expect(count).toBe(1)
    })
})
