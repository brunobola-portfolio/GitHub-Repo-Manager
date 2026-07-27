// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Migrations 30 + 31 — indexes that exist purely so two hot maintenance paths
 * stop full-scanning:
 *
 *   30. The event-retention purge (maintenance-janitors.purgeOldEvents) deletes
 *       in LIMIT-ed batches filtered only by a timestamp column. Without a
 *       timestamp-leading index every batch rescans the table from row 1, so a
 *       200-batch backlog costs 200 full scans.
 *   31. gh-cache.invalidateByRepo matches `resource_key LIKE 'owner/repo%'`.
 *       SQLite only rewrites a prefix LIKE into a range scan when the indexed
 *       column's collation matches LIKE's case-insensitive comparison, so the
 *       BINARY index shipped with the table never applied.
 *
 * These assert the query PLAN, not just the index's existence: an index nothing
 * uses fixes nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS } from '../lib/db-migrations.js';
import { makeIntegrationDb } from './helpers/integration-db.js';

const migration = (v) => MIGRATIONS.find((m) => m.version === v);

// initDB pulls in server/db.js, which opens the real database adapter as a
// module-level side effect — import lazily so a bare run never touches it.
async function makeFullDb() {
    const { initDB } = await import('../db.js');
    return makeIntegrationDb(initDB);
}

const plan = (db, sql, ...params) =>
    db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => r.detail).join(' | ');

// Mirrors EVENT_TABLES in server/lib/maintenance-janitors.js.
const EVENT_PURGE_TARGETS = [
    { table: 'pr_events', column: 'created_at', index: 'idx_pr_events_created' },
    { table: 'issue_events', column: 'created_at', index: 'idx_issue_events_created' },
    { table: 'deployment_events', column: 'created_at', index: 'idx_deployment_events_created' },
    { table: 'review_assignments', column: 'requested_at', index: 'idx_review_assignments_requested' },
    { table: 'workflow_runs', column: 'created_at', index: 'idx_workflow_runs_created' },
];

/** The exact statement purgeOldEvents prepares, per table. */
const purgeSql = ({ table, column }) => `
    DELETE FROM ${table} WHERE rowid IN (
        SELECT rowid FROM ${table}
        WHERE ${column} IS NOT NULL AND ${column} < datetime('now', ?)
        LIMIT ?
    )`;

describe('migration 30 — timestamp-leading indexes for the event purge', () => {
    let db;

    beforeAll(async () => {
        db = await makeFullDb();
    });

    it('is registered and idempotent when re-applied', async () => {
        expect(migration(30)).toBeDefined();
        const fresh = await makeFullDb();
        expect(() => migration(30).up(fresh)).not.toThrow();
        expect(() => migration(30).up(fresh)).not.toThrow();
    });

    for (const target of EVENT_PURGE_TARGETS) {
        it(`creates ${target.index} on ${target.table}(${target.column})`, () => {
            const row = db
                .prepare(`SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name = ?`)
                .get(target.index);
            expect(row).toBeDefined();
            expect(row.tbl_name).toBe(target.table);

            const columns = db.prepare(`PRAGMA index_info(${target.index})`).all();
            expect(columns[0].name).toBe(target.column);
        });

        it(`the ${target.table} purge batch becomes an index range seek, not a scan`, () => {
            const detail = plan(db, purgeSql(target), '-365 days', 5000);
            expect(detail).toContain(target.index);
            expect(detail).toMatch(new RegExp(`SEARCH ${target.table} USING (COVERING )?INDEX ${target.index}`));
            // A leading-timestamp index that the planner only SCANs would be
            // just as quadratic as no index at all.
            expect(detail).not.toMatch(new RegExp(`SCAN ${target.table}\\b`));
        });
    }

    it('the purge still deletes exactly the rows past the cutoff', () => {
        db.prepare(`
            INSERT INTO pr_events (github_event_id, repo_id, repo_full_name, pr_number, action, created_at)
            VALUES ('mig30-old', 4242, 'acme/site', 1, 'opened', datetime('now', '-400 days'))
        `).run();
        db.prepare(`
            INSERT INTO pr_events (github_event_id, repo_id, repo_full_name, pr_number, action, created_at)
            VALUES ('mig30-new', 4242, 'acme/site', 2, 'opened', datetime('now', '-10 days'))
        `).run();

        const info = db.prepare(purgeSql(EVENT_PURGE_TARGETS[0])).run('-365 days', 5000);
        expect(info.changes).toBe(1);
        const left = db.prepare(`SELECT github_event_id FROM pr_events WHERE repo_id = 4242`).all();
        expect(left.map((r) => r.github_event_id)).toEqual(['mig30-new']);
    });
});

describe('migration 31 — NOCASE gh_cache index for prefix invalidation', () => {
    let db;

    beforeAll(async () => {
        db = await makeFullDb();
    });

    it('is registered and idempotent when re-applied', async () => {
        expect(migration(31)).toBeDefined();
        const fresh = await makeFullDb();
        expect(() => migration(31).up(fresh)).not.toThrow();
        expect(() => migration(31).up(fresh)).not.toThrow();
        const sql = fresh
            .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_gh_cache_resource_type'`)
            .get().sql;
        expect(sql).toMatch(/NOCASE/i);
    });

    it('rebuilds idx_gh_cache_resource_type with a NOCASE resource_key', () => {
        const row = db
            .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_gh_cache_resource_type'`)
            .get();
        expect(row).toBeDefined();
        expect(row.sql).toMatch(/resource_key COLLATE NOCASE/i);
    });

    it('turns the anchored invalidateByRepo LIKE into an index range seek', () => {
        const detail = plan(
            db,
            'DELETE FROM gh_cache WHERE resource_key LIKE ? AND resource_type = ?',
            'acme/site%',
            'pulls',
        );
        expect(detail).toContain('idx_gh_cache_resource_type');
        expect(detail).toMatch(/resource_key>\? AND resource_key<\?/);
    });

    it('a leading-wildcard pattern would NOT seek — the anchor is what buys the index', () => {
        const detail = plan(
            db,
            'DELETE FROM gh_cache WHERE resource_key LIKE ? AND resource_type = ?',
            '%acme/site%',
            'pulls',
        );
        expect(detail).not.toMatch(/resource_key>\?/);
    });

    it('seeks for every resource_type the webhook handlers invalidate', () => {
        // github-events/{issue_comment,pull_request_review_comment,push}.js
        for (const type of ['issue_comments', 'pull_comments', 'issues', 'pulls', 'pull_reviews', 'commits', 'branches']) {
            const detail = plan(
                db,
                'DELETE FROM gh_cache WHERE resource_key LIKE ? AND resource_type = ?',
                'acme/site%',
                type,
            );
            expect(detail, type).toMatch(/resource_key>\? AND resource_key<\?/);
        }
    });
});
