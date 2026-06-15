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

const mockFetchMyPendingReviews = vi.fn();
const mockFetchMyOpenPRs = vi.fn();
const mockFetchMyOpenIssues = vi.fn();
const mockFetchStalePRs = vi.fn();
vi.mock('../lib/work-board-github.js', () => ({
    fetchMyPendingReviews: (...a) => mockFetchMyPendingReviews(...a),
    fetchMyOpenPRs: (...a) => mockFetchMyOpenPRs(...a),
    fetchMyOpenIssues: (...a) => mockFetchMyOpenIssues(...a),
    fetchStalePRs: (...a) => mockFetchStalePRs(...a),
}));

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

    it('returns one section per requested key with items present', async () => {
        seedReviewAssignment('foo/bar', 1);
        seedReviewAssignment('foo/bar', 2);

        const result = await composeInbox(USER_ID, {
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

    it('returns empty items array for a section with no data, not undefined', async () => {
        const result = await composeInbox(USER_ID, {
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

    it('lists PRs authored by user', async () => {
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 7, 'opened', LOGIN, 'feat: thing', '2026-05-01T00:00:00Z');

        const result = await composeInbox(USER_ID, { userLogin: LOGIN, sections: ['my_prs'] });
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

    it('lists issues assigned to user', async () => {
        // issue_events uses assignee_logins (plural, JSON array) not assignee_login
        db.prepare(`INSERT INTO issue_events
            (repo_id, repo_full_name, issue_number, action, assignee_logins, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 11, 'opened', JSON.stringify([LOGIN]), 'bug: x', '2026-05-01T00:00:00Z');

        const result = await composeInbox(USER_ID, { userLogin: LOGIN, sections: ['mentions'] });
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

    it('lists open PRs older than 7 days authored by user', async () => {
        const oldDate = new Date(Date.now() - 14 * 86400_000).toISOString();
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 5, 'opened', LOGIN, 'wip', oldDate);

        const result = await composeInbox(USER_ID, { userLogin: LOGIN, sections: ['stale_drafts'] });
        expect(result.sections[0].items[0]).toMatchObject({
            id: 'pr:foo/bar#5',
            section: 'stale_drafts',
        });
    });
});

describe('composeInbox — meta.live flag', () => {
    it('returns meta.live === true when a token is supplied', async () => {
        const result = await composeInbox(USER_ID, {
            userLogin: LOGIN,
            token: 'tok',
            sections: ['my_prs'],
        });
        expect(result.meta).toEqual({ live: true });
    });

    it('returns meta.live === false when no token is supplied', async () => {
        const result = await composeInbox(USER_ID, {
            userLogin: LOGIN,
            sections: ['my_prs'],
        });
        expect(result.meta).toEqual({ live: false });
    });
});

describe('composeInbox — unknown sections', () => {
    it('silently drops sections that are not in SECTION_KEYS (e.g. retired phase-2 stubs)', async () => {
        // failing_ci and dependabot_ready were removed when Phase 2/3 backing data
        // was not implemented — this guards against accidentally re-introducing them
        // without the corresponding builder.
        const result = await composeInbox(USER_ID, { userLogin: LOGIN, sections: ['dependabot_ready', 'failing_ci'] });
        expect(result.sections).toEqual([]);
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

    it('a PR appearing in both my_prs and needs_review keeps only the higher-priority section (needs_review)', async () => {
        // Same PR: alice is author AND a reviewer was requested from her (edge case)
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 9, 'opened', LOGIN, 'self-review', '2026-05-01T00:00:00Z');
        seedReviewAssignmentLocal('foo/bar', 9);

        const result = await composeInbox(USER_ID, {
            userLogin: LOGIN,
            sections: ['needs_review', 'my_prs'],
        });

        const inNeeds = result.sections.find(s => s.key === 'needs_review').items.some(i => i.id === 'pr:foo/bar#9');
        const inMy = result.sections.find(s => s.key === 'my_prs').items.some(i => i.id === 'pr:foo/bar#9');
        expect(inNeeds).toBe(true);
        expect(inMy).toBe(false);
    });
});

describe('composeInbox — archive / snooze filter', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM review_assignments').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    function seedReviewAssignmentLocal(repo, prNumber, ageHoursAgo = 3) {
        const requestedAt = new Date(Date.now() - ageHoursAgo * 3600_000).toISOString();
        db.prepare(`INSERT INTO review_assignments
            (repo_id, repo_full_name, pr_number, reviewer_login, state, requested_at)
            VALUES (?, ?, ?, ?, ?, ?)`).run(1, repo, prNumber, LOGIN, 'pending', requestedAt);
    }

    it('hides items with archived_at set unless includeArchived=true', async () => {
        seedReviewAssignmentLocal('foo/bar', 1);
        db.prepare(`INSERT INTO dashboard_inbox_state
            (user_id, item_id, archived_at) VALUES (?, ?, ?)`).run(USER_ID, 'pr:foo/bar#1', new Date().toISOString());

        expect((await composeInbox(USER_ID, { userLogin: LOGIN, sections: ['needs_review'] }))
            .sections[0].items).toEqual([]);

        expect((await composeInbox(USER_ID, { userLogin: LOGIN, sections: ['needs_review'], includeArchived: true }))
            .sections[0].items).toHaveLength(1);
    });

    it('hides items snoozed until a future timestamp; restores after expiry', async () => {
        seedReviewAssignmentLocal('foo/bar', 2);
        const future = new Date(Date.now() + 3600_000).toISOString();
        db.prepare(`INSERT INTO dashboard_inbox_state
            (user_id, item_id, snoozed_until) VALUES (?, ?, ?)`).run(USER_ID, 'pr:foo/bar#2', future);
        expect((await composeInbox(USER_ID, { userLogin: LOGIN, sections: ['needs_review'] }))
            .sections[0].items).toEqual([]);

        const past = new Date(Date.now() - 1000).toISOString();
        db.prepare('UPDATE dashboard_inbox_state SET snoozed_until = ? WHERE item_id = ?').run(past, 'pr:foo/bar#2');
        expect((await composeInbox(USER_ID, { userLogin: LOGIN, sections: ['needs_review'] }))
            .sections[0].items).toHaveLength(1);
    });
});

describe('composeInbox — live (token) path', () => {
    beforeEach(() => {
        mockFetchMyPendingReviews.mockReset();
        mockFetchMyOpenPRs.mockReset();
        mockFetchMyOpenIssues.mockReset();
        mockFetchStalePRs.mockReset();
        db.prepare('DELETE FROM pr_events').run();
        db.prepare('DELETE FROM review_assignments').run();
        db.prepare('DELETE FROM issue_events').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('my_prs uses the live fetcher when a token is present (ignores empty DB)', async () => {
        mockFetchMyOpenPRs.mockResolvedValue({ items: [
            { repoFullName: 'org/live', prNumber: 158, title: 'live PR', authorLogin: LOGIN,
              openedAt: '2026-06-14T00:00:00Z', ageHours: 1 },
        ], totalCount: 1 });

        const result = await composeInbox(USER_ID, { userLogin: LOGIN, token: 'tok', sections: ['my_prs'] });

        expect(mockFetchMyOpenPRs).toHaveBeenCalledWith({ token: 'tok', login: LOGIN });
        expect(result.sections[0].items[0]).toMatchObject({
            id: 'pr:org/live#158', section: 'my_prs', title: 'live PR',
        });
    });

    it('falls back to the DB query for a section when its live fetch throws', async () => {
        mockFetchMyOpenPRs.mockRejectedValue(new Error('rate limited'));
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 7, 'opened', LOGIN, 'db PR', '2026-05-01T00:00:00Z');

        const result = await composeInbox(USER_ID, { userLogin: LOGIN, token: 'tok', sections: ['my_prs'] });

        expect(result.sections[0].items[0]).toMatchObject({ id: 'pr:foo/bar#7', title: 'db PR' });
    });

    it('still applies archive/snooze + dedup on the live path', async () => {
        mockFetchMyPendingReviews.mockResolvedValue({ items: [
            { repoFullName: 'org/live', prNumber: 9, title: 'rev', authorLogin: 'bob',
              requestedAt: '2026-06-14T00:00:00Z', ageHours: 2 },
        ], totalCount: 1 });
        mockFetchMyOpenPRs.mockResolvedValue({ items: [
            { repoFullName: 'org/live', prNumber: 9, title: 'rev', authorLogin: LOGIN,
              openedAt: '2026-06-14T00:00:00Z', ageHours: 2 },
        ], totalCount: 1 });

        const result = await composeInbox(USER_ID, {
            userLogin: LOGIN, token: 'tok', sections: ['needs_review', 'my_prs'],
        });
        const inNeeds = result.sections.find(s => s.key === 'needs_review').items.some(i => i.id === 'pr:org/live#9');
        const inMy = result.sections.find(s => s.key === 'my_prs').items.some(i => i.id === 'pr:org/live#9');
        expect(inNeeds).toBe(true);
        expect(inMy).toBe(false);
    });
});
