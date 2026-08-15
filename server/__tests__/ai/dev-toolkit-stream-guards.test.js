// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
//
// Integration coverage for the streaming spend-cap + spend-record + audit
// wiring on the Dev Toolkit routes (server/routes/ai/dev-toolkit.js).
// Exercises the three structural shapes: a `?stream=true`-gated endpoint
// (generate-commit), a signal-passing one (review-summary), and an
// always-streaming one (chat-refine).

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { initDB } = await vi.importActual('../../db.js');
const { makeIntegrationDb } = await import('../helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);
vi.mock('../../db.js', () => ({ default: testDb }));

const USER_ID = 1;

// Configurable streaming provider — tests set the chunks/usage per endpoint.
let streamChunks = ['{}'];
let streamMeta = { usage: { inputTokens: 50, outputTokens: 10 }, costUSD: 0.03 };
const fakeProvider = {
    model: 'mock-model',
    async *generateStream() {
        for (const c of streamChunks) yield c;
        return streamMeta;
    },
    generate: vi.fn(),
};

// Auth: inject a session + (via createRequireAI, used by shared.js) a provider.
vi.mock('../../middleware/auth.js', async (orig) => {
    const actual = await orig();
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: USER_ID, accessToken: 'tok' };
            req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
            next();
        },
        createRequireAI: () => (req, _res, next) => { req.aiProvider = fakeProvider; next(); },
    };
});

// Body validation passthrough.
vi.mock('../../middleware/validate-request.js', () => ({
    validateBody: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => next(),
    validateParams: () => (req, _res, next) => next(),
}));

// Quota allowed (the cost guard, not the quota meter, is under test here).
vi.mock('../../lib/usage-meter.js', () => ({
    // Added with reserveAIQuota: a FULL module mock silently drops new
    // exports, and route handlers then call undefined and 500.
    guardedIncrementAIUsage: vi.fn(() => ({ allowed: true, metric: 'ai', current: 0, limit: 100, remaining: 100 })),
    releaseGuardedAIUsage: vi.fn(),

    checkUsageLimit: () => ({ allowed: true }),
    checkAIFeatureLimit: () => ({ allowed: true }),
    incrementUsage: vi.fn(),
    incrementAIUsage: vi.fn(),
    quotaExceededResponse: () => ({ error: 'quota', code: 'QUOTA_EXCEEDED' }),
}));

// No network for the README/contents fetches.
vi.mock('../../lib/github-api.js', () => ({
    githubApi: vi.fn(async () => ({ data: {}, headers: new Map() })),
}));

const { default: devToolkitRouter } = await import('../../routes/ai/dev-toolkit.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', devToolkitRouter);
    return app;
}

function spendCents() {
    return testDb.prepare('SELECT cents + micro_cents / 10000 AS cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents ?? 0;
}
function auditRow(action) {
    return testDb.prepare(
        'SELECT action, details FROM audit_log_v2 WHERE user_id = ? AND action = ? ORDER BY id DESC LIMIT 1'
    ).get(USER_ID, action);
}

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    streamChunks = ['{}'];
    streamMeta = { usage: { inputTokens: 50, outputTokens: 10 }, costUSD: 0.03 };
    delete process.env.AI_SPEND_CAP_CENTS;
    fakeProvider.generate.mockReset();
});

describe('POST /ai/generate-commit?stream=true', () => {
    it('records monthly spend + a PII-safe audit entry after the stream', async () => {
        streamChunks = ['{"subject":"feat: x",', '"body":""}'];
        const res = await request(makeApp())
            .post('/ai/generate-commit?stream=true')
            .send({ diff: 'a diff', format: 'conventional' });

        expect(res.status).toBe(200);
        expect(res.text).toContain('"done":true');
        expect(spendCents()).toBe(3); // 0.03 USD

        const audit = auditRow('ai_generate_commit');
        expect(audit).toBeTruthy();
        const details = JSON.parse(audit.details);
        expect(details).toMatchObject({
            format: 'conventional',
            streamed: true,
            inputTokens: 50,
            outputTokens: 10,
        });
        expect(JSON.stringify(details)).not.toContain('a diff');
    });

    it('returns 429 AI_SPEND_CAP_REACHED before streaming when over the monthly cap', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, month, 150);

        const res = await request(makeApp())
            .post('/ai/generate-commit?stream=true')
            .send({ diff: 'a diff', format: 'conventional' });

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
    });
});

describe('POST /ai/review-summary?stream=true', () => {
    it('records spend after the stream', async () => {
        streamChunks = ['{"overview":"ok","riskLevel":"low","keyChanges":[],"fileRisks":[],"suggestedReviewOrder":[],"estimatedReviewTime":"5m"}'];
        const res = await request(makeApp())
            .post('/ai/review-summary?stream=true')
            .send({ fileManifest: [], topFilePatches: [], prMetadata: { title: 'PR', additions: 1, deletions: 0, repo: 'a/b', number: 5 } });

        expect(res.status).toBe(200);
        expect(spendCents()).toBe(3);
        expect(auditRow('ai.review_summary')).toBeTruthy();
    });
});

describe('POST /ai/chat-refine (always streaming)', () => {
    it('records spend after the stream', async () => {
        streamChunks = ['refined text'];
        const res = await request(makeApp())
            .post('/ai/chat-refine')
            .send({ message: 'make it shorter', content_type: 'commit' });

        expect(res.status).toBe(200);
        expect(spendCents()).toBe(3);
        expect(auditRow('ai_chat_refine')).toBeTruthy();
    });

    it('returns 429 before streaming when over the monthly cap', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, month, 150);

        const res = await request(makeApp())
            .post('/ai/chat-refine')
            .send({ message: 'hi', content_type: 'commit' });

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
    });
});
