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
