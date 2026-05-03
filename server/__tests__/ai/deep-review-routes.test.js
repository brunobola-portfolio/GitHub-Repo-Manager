// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node

// Must come before any module that imports server/config.js (like middleware/auth.js).
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { initDB } = await vi.importActual('../../db.js');
const { makeIntegrationDb } = await import('../helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);

vi.mock('../../db.js', () => ({ default: testDb }));

// Provider mock — minimal duck-typed AIProvider
const mockGenerate = vi.fn(async () => ({
    parsed: {
        walkthrough: {
            summary: 'AI summary',
            perFileTable: [{ path: 'a.js', change: 'modified', summary: 'tweaked' }],
            mermaid: '',
            estimatedReviewTime: '5 min',
            riskLevel: 'low',
        },
        lineComments: [
            { path: 'a.js', side: 'RIGHT', line: 1, severity: 'info', body: 'hi' },
        ],
    },
}));
const mockProvider = {
    model: {},
    _modelName: 'gemini-2.5-flash',
    generate: mockGenerate,
};
const createProviderForUserMock = vi.fn(async () => mockProvider);
vi.mock('../../lib/ai-provider.js', async (importActual) => {
    const actual = await importActual();
    return { ...actual, createProviderForUser: (...args) => createProviderForUserMock(...args) };
});

// githubApi(path, token, options) — must match real signature
const githubApiMock = vi.fn(async (path /* , token, options */) => {
    if (path.includes('/pulls/42/files')) {
        return {
            data: [
                { filename: 'a.js', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '@@ ... @@' },
            ],
            headers: new Map(),
        };
    }
    if (/\/pulls\/42$/.test(path)) {
        return {
            data: {
                number: 42,
                title: 'Add X',
                user: { login: 'alice' },
                body: 'desc',
                additions: 1,
                deletions: 0,
                head: { sha: 'sha-head' },
                base: { sha: 'sha-base' },
            },
            headers: new Map(),
        };
    }
    if (path.endsWith('/reviews')) {
        return { data: { id: 9999 }, headers: new Map() };
    }
    return { data: {}, headers: new Map() };
});
vi.mock('../../lib/github-api.js', () => ({
    githubApi: (...args) => githubApiMock(...args),
}));

const {
    default: deepReviewRouter,
    _resetRateLimits,
} = await import('../../routes/ai/deep-review.js');

const USER_ID = 1;

function makeApp(userId = USER_ID) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId, accessToken: 'fake-token', login: 'alice' };
        req.log = { error: () => {}, warn: () => {}, info: () => {} };
        next();
    });
    app.use('/api/ai/deep-review', deepReviewRouter);
    return app;
}

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_pr_reviews').run();
    testDb.prepare('DELETE FROM gh_outbox').run();
    testDb.prepare('DELETE FROM gh_cache').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    githubApiMock.mockClear();
    mockGenerate.mockClear();
    createProviderForUserMock.mockReset();
    createProviderForUserMock.mockResolvedValue(mockProvider);
    _resetRateLimits();
});

describe('POST /api/ai/deep-review/:owner/:repo/:pr', () => {
    it('generates a draft and persists it', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(res.status).toBe(200);
        expect(res.body.draftId).toBeGreaterThan(0);
        expect(res.body.draft.walkthrough.summary).toBe('AI summary');
        expect(res.body.draft.lineComments).toHaveLength(1);
        expect(res.body.lastReviewedSha).toBe('sha-head');
    });

    it('returns 404 when no provider is configured', async () => {
        createProviderForUserMock.mockResolvedValueOnce(null);
        const app = makeApp();
        const res = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NO_AI_PROVIDER');
    });
});

describe('GET /api/ai/deep-review/:owner/:repo/:pr', () => {
    it('returns the cached draft when present, no LLM call', async () => {
        const app = makeApp();
        await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        mockGenerate.mockClear();
        const res = await request(app).get('/api/ai/deep-review/acme/api/42');
        expect(res.status).toBe(200);
        expect(res.body.draft.walkthrough.summary).toBe('AI summary');
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('returns 404 when no draft exists', async () => {
        const app = makeApp();
        const res = await request(app).get('/api/ai/deep-review/acme/api/999');
        expect(res.status).toBe(404);
    });
});

describe('PATCH /api/ai/deep-review/:draftId/comments/:commentIdx', () => {
    it('removes a comment by index', async () => {
        const app = makeApp();
        const created = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        const draftId = created.body.draftId;
        const res = await request(app)
            .patch(`/api/ai/deep-review/${draftId}/comments/0`)
            .send({ action: 'dismiss' });
        expect(res.status).toBe(200);
        expect(res.body.draft.lineComments).toHaveLength(0);
    });

    it('edits a comment body and suggestion in-place', async () => {
        const app = makeApp();
        const created = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        const draftId = created.body.draftId;
        const res = await request(app)
            .patch(`/api/ai/deep-review/${draftId}/comments/0`)
            .send({ action: 'edit', body: 'edited body', suggestion: 'foo()' });
        expect(res.status).toBe(200);
        expect(res.body.draft.lineComments[0].body).toBe('edited body');
        expect(res.body.draft.lineComments[0].suggestion).toBe('foo()');
    });
});

describe('POST /api/ai/deep-review/:draftId/publish', () => {
    it('posts to GitHub and marks the draft published', async () => {
        const app = makeApp();
        const created = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        const draftId = created.body.draftId;
        const res = await request(app)
            .post(`/api/ai/deep-review/${draftId}/publish`)
            .send({ event: 'COMMENT' });
        expect(res.status).toBe(200);
        expect(res.body.githubReviewId).toBe(9999);
        // Verify githubApi was called with the reviews endpoint
        const reviewsCall = githubApiMock.mock.calls.find((c) => /\/reviews$/.test(c[0]));
        expect(reviewsCall).toBeTruthy();
    });
});

describe('DELETE /api/ai/deep-review/:draftId', () => {
    it('discards the draft', async () => {
        const app = makeApp();
        const created = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        const res = await request(app).delete(`/api/ai/deep-review/${created.body.draftId}`);
        expect(res.status).toBe(204);
    });
});

describe('rate limiting on POST generate', () => {
    it('returns 429 after 10 generations per minute per user', async () => {
        const app = makeApp();
        // First 10 succeed
        for (let i = 0; i < 10; i++) {
            const r = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
            expect(r.status).toBe(200);
        }
        // 11th hits the limit
        const overflow = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(overflow.status).toBe(429);
        expect(overflow.body.code).toBe('RATE_LIMITED');
        expect(overflow.headers['retry-after']).toBeDefined();
    });
});
