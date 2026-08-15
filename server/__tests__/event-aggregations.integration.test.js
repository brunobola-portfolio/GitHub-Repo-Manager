// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
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

const { listMyOpenPRs, listStalePRs, listMyPendingReviews, listTechDebtIssues } = await import('../lib/event-aggregations.js');

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

// ---------------------------------------------------------------------------
// listMyPendingReviews integration tests — guards the correlated-subquery
// rewrite (was a cross-tenant full scan of pr_events).
// ---------------------------------------------------------------------------

function insertReviewAssignment(repoId, repoFullName, prNumber, reviewerLogin, state, requestedAt) {
    testDb.prepare(`
        INSERT INTO review_assignments (repo_id, repo_full_name, pr_number, reviewer_login, state, requested_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(repoId, repoFullName, prNumber, reviewerLogin, state, requestedAt);
}

describe('listMyPendingReviews (integration)', () => {
    beforeEach(() => {
        testDb.prepare('DELETE FROM pr_events').run();
        testDb.prepare('DELETE FROM review_assignments').run();
    });

    it('returns pending reviews for the reviewer with title/author from the LATEST pr_event', () => {
        // Two events for pr 42 → latest title/author must win.
        insertPrEvent(1, 'foo/bar', 42, 'opened', 'alice', 'old title', '2026-05-01T00:00:00Z');
        insertPrEvent(1, 'foo/bar', 42, 'edited', 'alice', 'new title', '2026-05-02T00:00:00Z');
        insertReviewAssignment(1, 'foo/bar', 42, 'carol', 'pending', '2026-05-03T00:00:00Z');

        const rows = listMyPendingReviews({ reviewerLogin: 'carol' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ prNumber: 42, title: 'new title', authorLogin: 'alice' });
    });

    it('scopes to the reviewer and to pending state', () => {
        insertPrEvent(1, 'foo/bar', 42, 'opened', 'alice', 't', '2026-05-01T00:00:00Z');
        insertReviewAssignment(1, 'foo/bar', 42, 'carol', 'pending', '2026-05-03T00:00:00Z');
        insertReviewAssignment(1, 'foo/bar', 43, 'dave', 'pending', '2026-05-03T00:00:00Z');   // other reviewer
        insertReviewAssignment(1, 'foo/bar', 44, 'carol', 'completed', '2026-05-03T00:00:00Z'); // not pending

        expect(listMyPendingReviews({ reviewerLogin: 'carol' }).map(r => r.prNumber)).toEqual([42]);
    });

    it('returns the assignment with null title/author when no pr_event exists (LEFT-join parity)', () => {
        insertReviewAssignment(1, 'foo/bar', 99, 'carol', 'pending', '2026-05-03T00:00:00Z');
        const rows = listMyPendingReviews({ reviewerLogin: 'carol' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ prNumber: 99, title: null, authorLogin: null });
    });
});

// ---------------------------------------------------------------------------
// listTechDebtIssues integration tests — guards the repoIds-scoped inner
// subquery + the latest-snapshot / closed-exclusion correctness.
// ---------------------------------------------------------------------------

let _ieSeq = 0;
function insertIssueEvent(repoId, repoFullName, issueNumber, action, { labels = [], authorLogin = 'x', title = 't', createdAt } = {}) {
    _ieSeq += 1;
    testDb.prepare(`
        INSERT INTO issue_events (github_event_id, repo_id, repo_full_name, issue_number, action, author_login, title, assignee_logins, labels, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`test-ie-${_ieSeq}`, repoId, repoFullName, issueNumber, action, authorLogin, title, '[]', JSON.stringify(labels), createdAt);
}

describe('listTechDebtIssues (integration)', () => {
    beforeEach(() => {
        testDb.prepare('DELETE FROM issue_events').run();
        // repo 1: issue 1 open + tech-debt
        insertIssueEvent(1, 'foo/bar', 1, 'opened', { labels: ['tech-debt'], createdAt: '2026-05-01T00:00:00Z' });
        // repo 1: issue 2 open tech-debt then CLOSED → excluded
        insertIssueEvent(1, 'foo/bar', 2, 'opened', { labels: ['tech-debt'], createdAt: '2026-05-01T00:00:00Z' });
        insertIssueEvent(1, 'foo/bar', 2, 'closed', { labels: ['tech-debt'], createdAt: '2026-05-02T00:00:00Z' });
        // repo 1: issue 3 opened as 'bug' then RE-LABELLED tech-debt (latest snapshot wins) → included
        insertIssueEvent(1, 'foo/bar', 3, 'opened',  { labels: ['bug'], createdAt: '2026-05-01T00:00:00Z' });
        insertIssueEvent(1, 'foo/bar', 3, 'labeled', { labels: ['tech-debt'], createdAt: '2026-05-03T00:00:00Z' });
        // repo 2: issue 5 open + refactor (a debt label)
        insertIssueEvent(2, 'baz/qux', 5, 'opened', { labels: ['refactor'], createdAt: '2026-05-01T00:00:00Z' });
    });

    it('scopes to repoIds: only that repo\'s open debt issues, latest snapshot, closed excluded', () => {
        const nums = listTechDebtIssues({ repoIds: [1] }).map(r => r.issueNumber).sort((a, b) => a - b);
        expect(nums).toEqual([1, 3]); // issue 2 closed; repo 2 excluded
    });

    it('global call (no repoIds) returns open debt issues across all repos', () => {
        const keys = listTechDebtIssues({}).map(r => `${r.repoFullName}#${r.issueNumber}`).sort();
        expect(keys).toEqual(['baz/qux#5', 'foo/bar#1', 'foo/bar#3']);
    });
});
