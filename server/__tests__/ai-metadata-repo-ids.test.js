// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * GET /api/ai/metadata
 *
 *  - tenant scoping: never returns another user's rows, whether or not
 *    repo_ids narrowing is used
 *  - optional `?repo_ids=` narrows the result to that set (a defense against
 *    the previously fully-unbounded per-user SELECT, and matches the client
 *    surfaces that only need metadata for the repos currently on screen)
 *  - an explicit but empty repo_ids never falls back to "return everything"
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { initDB } = await vi.importActual('../db.js');
const { makeIntegrationDb } = await import('./helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);
vi.mock('../db.js', () => ({ default: testDb }));

vi.mock('../middleware/auth.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireAuth: (req, _res, next) => { req.session = { userId: sessionUserId }; next(); },
    safeError: (err, fallback) => err?.message || fallback,
}));

let sessionUserId = 1;

const { default: indexingRouter } = await import('../routes/ai/indexing.js');

function makeApp() {
    const app = express();
    app.use('/api', indexingRouter);
    return app;
}

function seed(userId, repoId, overrides = {}) {
    testDb.prepare(`
        INSERT INTO repo_metadata (repo_id, user_id, summary, topics, health_score, last_indexed)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(repoId, userId, overrides.summary ?? 'summary', overrides.topics ?? '[]', overrides.health_score ?? 80, new Date().toISOString());
}

beforeEach(() => {
    testDb.prepare('DELETE FROM repo_metadata').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (1, ?), (2, ?)').run('alice', 'bob');
    sessionUserId = 1;
    seed(1, 101);
    seed(1, 102);
    seed(2, 201); // another tenant — must never leak to user 1
});

describe('GET /api/ai/metadata', () => {
    it('returns only the requesting user\'s rows with no repo_ids filter', async () => {
        const res = await request(makeApp()).get('/api/ai/metadata');
        expect(res.status).toBe(200);
        expect(res.body.map((r) => r.repo_id).sort()).toEqual([101, 102]);
    });

    it('never leaks another tenant\'s metadata', async () => {
        const res = await request(makeApp()).get('/api/ai/metadata');
        expect(res.body.some((r) => r.repo_id === 201)).toBe(false);
    });

    it('narrows to the requested repo_ids', async () => {
        const res = await request(makeApp()).get('/api/ai/metadata?repo_ids=101');
        expect(res.status).toBe(200);
        expect(res.body.map((r) => r.repo_id)).toEqual([101]);
    });

    it('cannot use repo_ids to read another tenant\'s row', async () => {
        const res = await request(makeApp()).get('/api/ai/metadata?repo_ids=201');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('drops malformed ids instead of matching everything', async () => {
        const res = await request(makeApp()).get('/api/ai/metadata?repo_ids=abc,-1,0');
        expect(res.status).toBe(200);
        // Every candidate id was invalid, so the filter list is empty —
        // an explicit empty filter must not fall back to the unfiltered case.
        expect(res.body).toEqual([]);
    });

    it('mixed valid/invalid ids keeps only the valid ones', async () => {
        const res = await request(makeApp()).get('/api/ai/metadata?repo_ids=102,abc');
        expect(res.status).toBe(200);
        expect(res.body.map((r) => r.repo_id)).toEqual([102]);
    });
});
