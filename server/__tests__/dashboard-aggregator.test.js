// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Integration tests for composeInbox — real in-memory SQLite.
 *
 * Follows the same pattern as event-aggregations.integration.test.js:
 * vi.importActual grabs the real initDB before the mock is registered,
 * then vi.mock replaces db.js with the in-memory handle so the module
 * under test queries our test data instead of the real database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeIntegrationDb } from './helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../db.js');
const db = makeIntegrationDb(realInitDB);

vi.mock('../db.js', () => ({ default: db }));

const { composeInbox } = await import('../lib/dashboard-aggregator.js');

const USER_ID = 99;
const LOGIN = 'alice';

function seedReviewAssignment(repo, prNumber, ageHoursAgo = 3) {
    const requestedAt = new Date(Date.now() - ageHoursAgo * 3600_000).toISOString();
    db.prepare(`INSERT INTO review_assignments
        (repo_id, repo_full_name, pr_number, reviewer_login, state, requested_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(1, repo, prNumber, LOGIN, 'pending', requestedAt);
}

describe('composeInbox — needs_review section', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM review_assignments').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('returns one section per requested key with items present', () => {
        seedReviewAssignment('foo/bar', 1);
        seedReviewAssignment('foo/bar', 2);

        const result = composeInbox(USER_ID, {
            userLogin: LOGIN,
            sections: ['needs_review'],
        });

        expect(result.sections).toHaveLength(1);
        expect(result.sections[0].key).toBe('needs_review');
        expect(result.sections[0].items).toHaveLength(2);
        expect(result.sections[0].items[0]).toMatchObject({
            id: expect.stringMatching(/^pr:foo\/bar#\d+$/),
            kind: 'pr',
            repoFullName: 'foo/bar',
            section: 'needs_review',
        });
    });

    it('returns empty items array for a section with no data, not undefined', () => {
        const result = composeInbox(USER_ID, {
            userLogin: LOGIN,
            sections: ['needs_review'],
        });
        expect(result.sections[0].items).toEqual([]);
    });
});

describe('composeInbox — my_prs section', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM pr_events').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('lists PRs authored by user', () => {
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 7, 'opened', LOGIN, 'feat: thing', '2026-05-01T00:00:00Z');

        const result = composeInbox(USER_ID, { userLogin: LOGIN, sections: ['my_prs'] });
        expect(result.sections[0].items[0]).toMatchObject({
            id: 'pr:foo/bar#7',
            section: 'my_prs',
            title: 'feat: thing',
        });
    });
});

describe('composeInbox — mentions section', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM issue_events').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('lists issues assigned to user', () => {
        // issue_events uses assignee_logins (plural, JSON array) not assignee_login
        db.prepare(`INSERT INTO issue_events
            (repo_id, repo_full_name, issue_number, action, assignee_logins, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 11, 'opened', JSON.stringify([LOGIN]), 'bug: x', '2026-05-01T00:00:00Z');

        const result = composeInbox(USER_ID, { userLogin: LOGIN, sections: ['mentions'] });
        expect(result.sections[0].items[0]).toMatchObject({
            id: 'issue:foo/bar#11',
            section: 'mentions',
            title: 'bug: x',
        });
    });
});

describe('composeInbox — stale_drafts section', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM pr_events').run();
    });

    it('lists open PRs older than 7 days authored by user', () => {
        const oldDate = new Date(Date.now() - 14 * 86400_000).toISOString();
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 5, 'opened', LOGIN, 'wip', oldDate);

        const result = composeInbox(USER_ID, { userLogin: LOGIN, sections: ['stale_drafts'] });
        expect(result.sections[0].items[0]).toMatchObject({
            id: 'pr:foo/bar#5',
            section: 'stale_drafts',
        });
    });
});

describe('composeInbox — dependabot_ready section', () => {
    it('returns empty array when no dependabot PRs (placeholder until repos-security wired)', () => {
        const result = composeInbox(USER_ID, { userLogin: LOGIN, sections: ['dependabot_ready'] });
        expect(result.sections[0].items).toEqual([]);
    });
});

describe('composeInbox — dedup across sections', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM pr_events').run();
        db.prepare('DELETE FROM review_assignments').run();
    });

    function seedReviewAssignmentLocal(repo, prNumber, ageHoursAgo = 3) {
        const requestedAt = new Date(Date.now() - ageHoursAgo * 3600_000).toISOString();
        db.prepare(`INSERT INTO review_assignments
            (repo_id, repo_full_name, pr_number, reviewer_login, state, requested_at)
            VALUES (?, ?, ?, ?, ?, ?)`).run(1, repo, prNumber, LOGIN, 'pending', requestedAt);
    }

    it('a PR appearing in both my_prs and needs_review keeps only the higher-priority section (needs_review)', () => {
        // Same PR: alice is author AND a reviewer was requested from her (edge case)
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 9, 'opened', LOGIN, 'self-review', '2026-05-01T00:00:00Z');
        seedReviewAssignmentLocal('foo/bar', 9);

        const result = composeInbox(USER_ID, {
            userLogin: LOGIN,
            sections: ['needs_review', 'my_prs'],
        });

        const inNeeds = result.sections.find(s => s.key === 'needs_review').items.some(i => i.id === 'pr:foo/bar#9');
        const inMy = result.sections.find(s => s.key === 'my_prs').items.some(i => i.id === 'pr:foo/bar#9');
        expect(inNeeds).toBe(true);
        expect(inMy).toBe(false);
    });
});
