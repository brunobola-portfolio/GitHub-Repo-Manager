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

// requireTier mock — deep-review routes are gated to 'pro'. Default test
// users to 'pro' tier; flip via `setTier('free')` to exercise the gate.
let currentTier = 'pro';
const TIER_ORDER = { free: 0, pro: 1, enterprise: 2 };
vi.mock('../../middleware/require-tier.js', () => ({
    requireTier: (minTier) => (req, res, next) => {
        const min = TIER_ORDER[minTier] ?? 0;
        const have = TIER_ORDER[currentTier] ?? 0;
        if (have >= min) return next();
        return res.status(403).json({ error: 'upgrade_required', requiredTier: minTier });
    },
    getUserTier: () => currentTier,
    attachTier: (req, _res, next) => { req.userTier = currentTier; next(); },
}));

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
    usage: { inputTokens: 200, outputTokens: 80 },
    costUSD: 0.04,
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
    _runRateLimitSweep,
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
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    githubApiMock.mockClear();
    mockGenerate.mockClear();
    createProviderForUserMock.mockReset();
    createProviderForUserMock.mockResolvedValue(mockProvider);
    _resetRateLimits();
    delete process.env.AI_SPEND_CAP_CENTS;
});

// Helpers for the metering assertions below.
const monthKey = () => new Date().toISOString().slice(0, 7);
function aiQueriesCount() {
    const { start } = { start: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString() };
    return testDb.prepare(
        "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_queries' AND period_start = ?"
    ).get(USER_ID, start)?.count ?? 0;
}
function seedAiQueries(count) {
    const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
    testDb.prepare(
        'INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end) VALUES (?, ?, ?, ?, ?)'
    ).run(USER_ID, 'ai_queries', count, start, end);
}

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

    it('meters the AI query (increments ai_queries) on success', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(res.status).toBe(200);
        expect(aiQueriesCount()).toBe(1);
    });

    it('records monthly spend + a PII-safe audit entry after generation', async () => {
        const app = makeApp();
        await request(app).post('/api/ai/deep-review/acme/api/42').send({});

        const cents = testDb.prepare('SELECT cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents;
        expect(cents).toBe(4); // 0.04 USD

        const audit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.deep_review' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(audit).toBeTruthy();
        const details = JSON.parse(audit.details);
        expect(details).toMatchObject({ feature: 'deep_review', inputTokens: 200, outputTokens: 80 });
    });

    it('returns 429 QUOTA_EXCEEDED when the monthly AI query cap is reached (provider not called)', async () => {
        seedAiQueries(5000); // Pro cap is 5000/mo
        const app = makeApp();
        const res = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('QUOTA_EXCEEDED');
        expect(createProviderForUserMock).not.toHaveBeenCalled();
    });

    it('returns 429 AI_SPEND_CAP_REACHED when over the monthly spend cap (provider not called)', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, monthKey(), 150);
        const app = makeApp();
        const res = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(createProviderForUserMock).not.toHaveBeenCalled();
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

    it('LRU sweep evicts stale buckets so requests succeed again', async () => {
        const app = makeApp();
        // Saturate the bucket — 10 requests in window
        for (let i = 0; i < 10; i++) {
            const r = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
            expect(r.status).toBe(200);
        }
        // 11th would normally 429 — but if we age the bucket past the window
        // and run the sweep, the entry should be dropped and the next request
        // should succeed.
        vi.useFakeTimers();
        try {
            // Travel past RATE_WINDOW_MS (60s) — now all timestamps are stale.
            vi.setSystemTime(new Date(Date.now() + 61_000));
            _runRateLimitSweep();
        } finally {
            vi.useRealTimers();
        }
        // After sweep clears the user's stale bucket, request 11 succeeds.
        const after = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(after.status).toBe(200);
    });

    it('_resetRateLimits clears all buckets', async () => {
        const app = makeApp();
        for (let i = 0; i < 10; i++) {
            await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        }
        const before = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(before.status).toBe(429);
        _resetRateLimits();
        const after = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(after.status).toBe(200);
    });
});
