// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { initDB } = await vi.importActual('../db.js');
const { makeIntegrationDb } = await import('./helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);

vi.mock('../db.js', () => ({ default: testDb }));

const {
    saveResult,
    getResult,
    getResultById,
    deleteResult,
} = await import('../lib/ai-pr-command-store.js');

const userId = 777;
const otherUserId = 778;

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_pr_commands').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(userId, 'test-user');
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(otherUserId, 'other-user');
});

describe('ai-pr-command-store', () => {
    it('saves and retrieves a result by composite key', () => {
        const id = saveResult(userId, 'acme', 'api', 42, 'describe', 'sha1',
            { title: 't', body: 'b' }, 0.05, 'gemini-2.5-flash');
        expect(id).toBeGreaterThan(0);
        const got = getResult(userId, 'acme', 'api', 42, 'describe');
        expect(got.output.title).toBe('t');
        expect(got.output.body).toBe('b');
        expect(got.lastHeadSha).toBe('sha1');
        expect(got.modelUsed).toBe('gemini-2.5-flash');
        expect(got.command).toBe('describe');
    });

    it('upserts on (user, owner, repo, pr, command) — keeps id stable', () => {
        const id1 = saveResult(userId, 'acme', 'api', 42, 'describe', 'sha1', { body: 'one' }, 0.01, 'm');
        const id2 = saveResult(userId, 'acme', 'api', 42, 'describe', 'sha2', { body: 'two' }, 0.02, 'm');
        expect(id2).toBe(id1);
        const got = getResult(userId, 'acme', 'api', 42, 'describe');
        expect(got.lastHeadSha).toBe('sha2');
        expect(got.output.body).toBe('two');
    });

    it('keeps separate rows per command on the same PR', () => {
        const id1 = saveResult(userId, 'acme', 'api', 42, 'describe', 's', { body: 'b' }, 0, 'm');
        const id2 = saveResult(userId, 'acme', 'api', 42, 'test_plan', 's', { summary: 'p', cases: [] }, 0, 'm');
        expect(id1).not.toBe(id2);
        expect(getResult(userId, 'acme', 'api', 42, 'describe').output.body).toBe('b');
        expect(getResult(userId, 'acme', 'api', 42, 'test_plan').output.summary).toBe('p');
    });

    it('getResult returns null when nothing cached', () => {
        expect(getResult(userId, 'acme', 'api', 42, 'improve')).toBeNull();
    });

    it('getResultById enforces user ownership', () => {
        const id = saveResult(userId, 'acme', 'api', 42, 'describe', 's', { body: 'b' }, 0, 'm');
        expect(getResultById(userId, id)).toBeTruthy();
        expect(getResultById(otherUserId, id)).toBeNull();
    });

    it('deleteResult removes only the (user, command) row', () => {
        saveResult(userId, 'acme', 'api', 42, 'describe', 's', { body: 'b' }, 0, 'm');
        saveResult(userId, 'acme', 'api', 42, 'improve', 's', { summary: 's', suggestions: [] }, 0, 'm');
        const deleted = deleteResult(userId, 'acme', 'api', 42, 'describe');
        expect(deleted).toBe(1);
        expect(getResult(userId, 'acme', 'api', 42, 'describe')).toBeNull();
        // The other command's row is untouched
        expect(getResult(userId, 'acme', 'api', 42, 'improve')).toBeTruthy();
    });

    it('deleteResult is a no-op when nothing matches', () => {
        const deleted = deleteResult(userId, 'acme', 'api', 99, 'describe');
        expect(deleted).toBe(0);
    });

    it('cross-user delete attempt is a no-op (IDOR guard)', () => {
        saveResult(userId, 'acme', 'api', 42, 'describe', 's', { body: 'b' }, 0, 'm');
        const deleted = deleteResult(otherUserId, 'acme', 'api', 42, 'describe');
        expect(deleted).toBe(0);
        expect(getResult(userId, 'acme', 'api', 42, 'describe')).toBeTruthy();
    });
});
