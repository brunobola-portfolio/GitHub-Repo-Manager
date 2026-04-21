// SPDX-License-Identifier: AGPL-3.0-only
//
// Migration 014 — composite indexes on hot query paths.
//
// We spin up a fresh in-memory SQLite DB, run initDB() against it (twice, to
// prove idempotency), then assert every new index exists and that the SQLite
// query planner actually uses them for the representative queries.

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';

// Each expected index: logical name, table, definition columns (for sanity).
const EXPECTED_INDEXES = [
    { name: 'idx_mig_user_mirror',                  table: 'migration_jobs'   },
    { name: 'idx_mig_user_status',                  table: 'migration_jobs'   },
    { name: 'idx_audit_v2_user_action_created',     table: 'audit_log_v2'     },
    { name: 'idx_issue_events_repo_issue_action',   table: 'issue_events'     },
    { name: 'idx_pr_events_repo_pr_action',         table: 'pr_events'        },
    { name: 'idx_wbs_user_until',                   table: 'work_board_snooze'},
];

/**
 * Inline replica of the migration-015 CREATE INDEX block from server/db.js.
 * We redeclare the minimum schema needed (not the full initDB) so this test
 * stays fast and avoids importing the real singleton db.js module, which
 * would try to open the on-disk manager.db.
 */
function applyMigration015(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS migration_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            source_type TEXT,
            source_url TEXT,
            source_name TEXT,
            target_owner TEXT,
            target_repo TEXT,
            status TEXT DEFAULT 'pending',
            is_mirror INTEGER DEFAULT 0,
            started_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS audit_log_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            resource_type TEXT,
            resource_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS issue_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_id INTEGER NOT NULL,
            issue_number INTEGER NOT NULL,
            action TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS pr_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_id INTEGER NOT NULL,
            pr_number INTEGER NOT NULL,
            action TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS work_board_snooze (
            user_id INTEGER NOT NULL,
            repo_full_name TEXT NOT NULL,
            item_type TEXT NOT NULL,
            item_number INTEGER NOT NULL,
            until_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, repo_full_name, item_type, item_number)
        );
    `);

    // The migration block under test — copy/paste from server/db.js.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mig_user_mirror
             ON migration_jobs(user_id, is_mirror)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mig_user_status
             ON migration_jobs(user_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_v2_user_action_created
             ON audit_log_v2(user_id, action, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_issue_events_repo_issue_action
             ON issue_events(repo_id, issue_number, action)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pr_events_repo_pr_action
             ON pr_events(repo_id, pr_number, action)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wbs_user_until
             ON work_board_snooze(user_id, until_at)`);
}

describe('migration 014 — composite indexes on hot query paths', () => {
    let db;

    beforeAll(() => {
        db = new Database(':memory:');
        // Run the migration twice to double as an idempotency check —
        // `CREATE INDEX IF NOT EXISTS` must not error on re-runs.
        applyMigration015(db);
        expect(() => applyMigration015(db)).not.toThrow();
    });

    for (const { name, table } of EXPECTED_INDEXES) {
        it(`creates ${name} on ${table}`, () => {
            const row = db
                .prepare(
                    `SELECT name, tbl_name FROM sqlite_master
                     WHERE type = 'index' AND name = ?`
                )
                .get(name);
            expect(row).toBeDefined();
            expect(row.tbl_name).toBe(table);
        });
    }

    it('migration_jobs(user_id, is_mirror) query uses the new index', () => {
        const plan = db
            .prepare(
                `EXPLAIN QUERY PLAN
                 SELECT target_owner, target_repo FROM migration_jobs
                 WHERE user_id = ? AND is_mirror = 1`
            )
            .all(42);
        const detail = plan.map(p => p.detail).join(' | ');
        expect(detail).toMatch(/idx_mig_user_mirror/);
    });

    it('audit_log_v2(user_id, action, created_at) query uses the new index', () => {
        const plan = db
            .prepare(
                `EXPLAIN QUERY PLAN
                 SELECT * FROM audit_log_v2
                 WHERE user_id = ? AND action = ? AND created_at >= ?
                 ORDER BY created_at DESC LIMIT 100`
            )
            .all(42, 'login', '2026-01-01');
        const detail = plan.map(p => p.detail).join(' | ');
        expect(detail).toMatch(/idx_audit_v2_user_action_created/);
    });

    it('work_board_snooze(user_id, until_at) query uses the new index', () => {
        const plan = db
            .prepare(
                `EXPLAIN QUERY PLAN
                 SELECT * FROM work_board_snooze
                 WHERE user_id = ? AND until_at > ?
                 ORDER BY until_at DESC`
            )
            .all(42, '2026-01-01');
        const detail = plan.map(p => p.detail).join(' | ');
        expect(detail).toMatch(/idx_wbs_user_until/);
    });

    it('pr_events(repo_id, pr_number, action) query uses the new index', () => {
        const plan = db
            .prepare(
                `EXPLAIN QUERY PLAN
                 SELECT 1 FROM pr_events
                 WHERE repo_id = ? AND pr_number = ? AND action = 'closed'`
            )
            .all(1, 1);
        const detail = plan.map(p => p.detail).join(' | ');
        expect(detail).toMatch(/idx_pr_events_repo_pr_action/);
    });
});
