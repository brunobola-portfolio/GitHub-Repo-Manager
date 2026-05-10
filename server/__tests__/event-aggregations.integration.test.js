// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Integration tests for listMyOpenPRs — real in-memory SQLite.
 *
 * These tests do NOT mock db.js. They exercise the real SQL against the full
 * schema so the "reopened PR" lifecycle bug cannot regress silently.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeIntegrationDb } from './helpers/integration-db.js';

// Grab the real initDB via importActual so the mock registered below does not
// hide the schema-building function we need for the test DB.
const { initDB: realInitDB } = await vi.importActual('../db.js');
const testDb = makeIntegrationDb(realInitDB);

vi.mock('../db.js', () => ({ default: testDb }));

const { listMyOpenPRs, listStalePRs } = await import('../lib/event-aggregations.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 0;
function insertPrEvent(repoId, repoFullName, prNumber, action, authorLogin, title, createdAt) {
    // github_event_id has a UNIQUE constraint; use a unique sentinel per call.
    _seq += 1;
    testDb.prepare(`
        INSERT INTO pr_events
            (github_event_id, repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`test-evt-${_seq}`, repoId, repoFullName, prNumber, action, authorLogin, title, createdAt);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listMyOpenPRs (integration)', () => {
    beforeEach(() => {
        testDb.prepare('DELETE FROM pr_events').run();
    });

    it('returns open PRs authored by the user, newest first', () => {
        insertPrEvent(1, 'foo/bar', 42, 'opened', 'alice', 'first',  '2026-05-01T00:00:00Z');
        insertPrEvent(1, 'foo/bar', 43, 'opened', 'alice', 'second', '2026-05-09T00:00:00Z');

        const rows = listMyOpenPRs({ authorLogin: 'alice' });
        expect(rows.map(r => r.prNumber)).toEqual([43, 42]);
    });

    it('excludes PRs whose latest event is closed', () => {
        insertPrEvent(1, 'foo/bar', 42, 'opened', 'alice', 'first', '2026-05-01T00:00:00Z');
        insertPrEvent(1, 'foo/bar', 42, 'closed', 'alice', 'first', '2026-05-02T00:00:00Z');

        expect(listMyOpenPRs({ authorLogin: 'alice' })).toEqual([]);
    });

    it('INCLUDES PRs that were closed then reopened (latest event = reopened)', () => {
        insertPrEvent(1, 'foo/bar', 50, 'opened',   'alice', 'r', '2026-05-01T00:00:00Z');
        insertPrEvent(1, 'foo/bar', 50, 'closed',   'alice', 'r', '2026-05-02T00:00:00Z');
        insertPrEvent(1, 'foo/bar', 50, 'reopened', 'alice', 'r', '2026-05-03T00:00:00Z');

        const rows = listMyOpenPRs({ authorLogin: 'alice' });
        expect(rows.map(r => r.prNumber)).toEqual([50]);
    });

    it('returns empty when authorLogin missing', () => {
        expect(listMyOpenPRs({})).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// listStalePRs integration tests
// ---------------------------------------------------------------------------

describe('listStalePRs (integration)', () => {
    // Use a fixed "old enough" date so cutoff math is deterministic.
    const OLD_DATE = '2026-01-01T00:00:00Z'; // well past any staleAfterDays threshold

    beforeEach(() => {
        testDb.prepare('DELETE FROM pr_events').run();
    });

    it('includes stale open PR authored by user', () => {
        insertPrEvent(1, 'org/repo', 10, 'opened', 'bob', 'stale PR', OLD_DATE);

        const rows = listStalePRs({ staleAfterDays: 7 });
        expect(rows.map(r => r.prNumber)).toContain(10);
    });

    it('excludes stale PR whose latest event is closed', () => {
        insertPrEvent(1, 'org/repo', 20, 'opened', 'bob', 'will close', OLD_DATE);
        insertPrEvent(1, 'org/repo', 20, 'closed', 'bob', 'will close', '2026-01-02T00:00:00Z');

        const rows = listStalePRs({ staleAfterDays: 7 });
        expect(rows.map(r => r.prNumber)).not.toContain(20);
    });

    it('INCLUDES stale PR that was closed then reopened (latest event = reopened)', () => {
        insertPrEvent(1, 'org/repo', 30, 'opened',   'bob', 'reopen me', OLD_DATE);
        insertPrEvent(1, 'org/repo', 30, 'closed',   'bob', 'reopen me', '2026-01-02T00:00:00Z');
        insertPrEvent(1, 'org/repo', 30, 'reopened', 'bob', 'reopen me', '2026-01-03T00:00:00Z');

        const rows = listStalePRs({ staleAfterDays: 7 });
        expect(rows.map(r => r.prNumber)).toContain(30);
    });
});
