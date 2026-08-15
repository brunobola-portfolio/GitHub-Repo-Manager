// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { initDB } = await vi.importActual('../db.js');
const { makeIntegrationDb } = await import('./helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);

vi.mock('../db.js', () => ({ default: testDb }));

const {
    saveDraft,
    getDraft,
    getDraftById,
    updateDraftJson,
    markPublished,
    deleteDraft,
} = await import('../lib/ai-pr-review-store.js');

const userId = 999;

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_pr_reviews WHERE user_id = ?').run(userId);
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(userId, 'test-user');
});

describe('ai-pr-review-store', () => {
    it('saves and retrieves a draft by composite key', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: { summary: 'x' }, lineComments: [] }, 0.05, 'gemini-2.5-flash');
        expect(id).toBeGreaterThan(0);
        const got = getDraft(userId, 'acme', 'api', 42);
        expect(got.draft.walkthrough.summary).toBe('x');
        expect(got.lastReviewedSha).toBe('sha1');
        expect(got.status).toBe('draft');
        expect(got.modelUsed).toBe('gemini-2.5-flash');
    });

    it('upserts on (user, owner, repo, pr) — keeps id stable', () => {
        const id1 = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: {}, lineComments: [] }, 0.01, 'm');
        const id2 = saveDraft(userId, 'acme', 'api', 42, 'sha2', { walkthrough: {}, lineComments: [] }, 0.02, 'm');
        expect(id2).toBe(id1);
        const got = getDraft(userId, 'acme', 'api', 42);
        expect(got.lastReviewedSha).toBe('sha2');
    });

    it('getDraftById enforces user ownership', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: {}, lineComments: [] }, 0, 'm');
        expect(getDraftById(userId, id)).toBeTruthy();
        expect(getDraftById(userId + 1, id)).toBeNull();
    });

    it('markPublished sets status + github_review_id', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: {}, lineComments: [] }, 0, 'm');
        markPublished(userId, id, 12345);
        const got = getDraftById(userId, id);
        expect(got.status).toBe('published');
        expect(got.githubReviewId).toBe(12345);
    });

    it('deleteDraft removes only the owner row', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: {}, lineComments: [] }, 0, 'm');
        const deleted = deleteDraft(userId, id);
        expect(deleted).toBe(1);
        expect(getDraftById(userId, id)).toBeNull();
    });

    it('updateDraftJson updates a draft in place', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: { summary: 'orig' }, lineComments: [] }, 0, 'm');
        const changes = updateDraftJson(userId, id, { walkthrough: { summary: 'edited' }, lineComments: [{ body: 'new' }] });
        expect(changes).toBe(1);
        const got = getDraftById(userId, id);
        expect(got.draft.walkthrough.summary).toBe('edited');
        expect(got.draft.lineComments).toHaveLength(1);
    });

    it('updateDraftJson refuses to update a published draft', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: {}, lineComments: [] }, 0, 'm');
        markPublished(userId, id, 12345);
        const changes = updateDraftJson(userId, id, { walkthrough: { summary: 'should not stick' }, lineComments: [] });
        expect(changes).toBe(0);
        const got = getDraftById(userId, id);
        expect(got.draft.walkthrough.summary).toBeUndefined();
    });
});
