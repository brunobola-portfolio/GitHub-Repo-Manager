// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Integration coverage for POST /ai/chat?stream=true (Repo Advisor streaming).
// Verifies clean reply deltas (not raw JSON), the { reply, actions } done
// envelope, spend/audit/quota wiring, and that the non-stream path is intact.

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { initDB } = await vi.importActual('../../db.js');
const { makeIntegrationDb } = await import('../helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);
vi.mock('../../db.js', () => ({ default: testDb }));

const USER_ID = 1;

// Plain async-generator method (NOT vi.fn — wrapping a generator in vi.fn
// breaks async iteration). Track invocations with a counter.
let streamCalls = 0;
const fakeProvider = {
    model: 'mock-model',
    async *generateStream() {
        streamCalls++;
        yield '{"reply":"Hello ';
        yield 'there","actions":[{"type":"open_settings","label":"Settings"}]}';
        return { usage: { inputTokens: 20, outputTokens: 10 }, costUSD: 0.02 };
    },
    generate: vi.fn(async () => ({
        text: '{"reply":"blocking reply","actions":[]}',
        parsed: { reply: 'blocking reply', actions: [] },
        usage: { inputTokens: 5, outputTokens: 3 },
        costUSD: 0.01,
    })),
};

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

vi.mock('../../middleware/validate-request.js', () => ({
    validateBody: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => next(),
    validateParams: () => (req, _res, next) => next(),
}));

vi.mock('../../lib/github-api.js', () => ({ githubApi: vi.fn(async () => ({ data: {}, headers: new Map() })) }));

const { default: coreRouter } = await import('../../routes/ai/core.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', coreRouter);
    return app;
}

const monthKey = () => new Date().toISOString().slice(0, 7);
const periodStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
function aiQueriesCount() {
    return testDb.prepare(
        "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_queries' AND period_start = ?"
    ).get(USER_ID, periodStart())?.count ?? 0;
}
function seedAiQueries(count) {
    const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
    testDb.prepare(
        'INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end) VALUES (?, ?, ?, ?, ?)'
    ).run(USER_ID, 'ai_queries', count, periodStart(), end);
}

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    streamCalls = 0;
    fakeProvider.generate.mockClear();
    delete process.env.AI_SPEND_CAP_CENTS;
});

describe('POST /api/ai/chat?stream=true', () => {
    it('streams clean reply deltas and a { reply, actions } done envelope', async () => {
        const res = await request(makeApp()).post('/api/ai/chat?stream=true').send({ message: 'hi' });
        expect(res.status).toBe(200);

        // Clean prose deltas — never the raw JSON envelope.
        expect(res.text).toContain(`data: ${JSON.stringify({ text: 'Hello ' })}`);
        expect(res.text).toContain(`data: ${JSON.stringify({ text: 'there' })}`);
        expect(res.text).not.toContain('data: {"text":"{'); // no raw JSON leaked as a chunk

        // Done envelope carries the parsed reply + whitelistable actions.
        expect(res.text).toContain('"done":true');
        expect(res.text).toContain('Hello there');
        expect(res.text).toContain('open_settings');
    });

    it('records spend + audit + meters the query after the stream', async () => {
        await request(makeApp()).post('/api/ai/chat?stream=true').send({ message: 'hi' });

        expect(aiQueriesCount()).toBe(1);
        expect(testDb.prepare('SELECT cents + micro_cents / 10000 AS cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents).toBe(2); // 0.02
        const audit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.chat' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(audit).toBeTruthy();
        expect(JSON.parse(audit.details)).toMatchObject({ feature: 'chat', streamed: true, inputTokens: 20, outputTokens: 10 });
    });

    it('returns 429 QUOTA_EXCEEDED before streaming when the AI query cap is reached', async () => {
        seedAiQueries(1000); // free-tier cap
        const res = await request(makeApp()).post('/api/ai/chat?stream=true').send({ message: 'hi' });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('QUOTA_EXCEEDED');
        expect(streamCalls).toBe(0);
    });

    it('returns 429 AI_SPEND_CAP_REACHED before streaming when over the spend cap', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, monthKey(), 150);
        const res = await request(makeApp()).post('/api/ai/chat?stream=true').send({ message: 'hi' });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(streamCalls).toBe(0);
    });
});

describe('POST /api/ai/chat (non-stream, regression)', () => {
    it('still returns a blocking JSON { reply, actions } and does not stream', async () => {
        const res = await request(makeApp()).post('/api/ai/chat').send({ message: 'hi' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ reply: 'blocking reply', actions: [] });
        expect(fakeProvider.generate).toHaveBeenCalledTimes(1);
        expect(streamCalls).toBe(0);
    });
});
