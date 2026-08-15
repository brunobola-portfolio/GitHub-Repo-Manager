// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { initDB } = await vi.importActual('../../db.js');
const { makeIntegrationDb } = await import('../helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);

vi.mock('../../db.js', () => ({ default: testDb }));

// Pro-tier middleware mock
let currentTier = 'pro';
function setTier(t) { currentTier = t; }
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

// Streaming AI provider mock — yields a fixed reply chunked into 3 parts and
// reports post-stream usage (so spend/audit wiring can be exercised).
const mockProvider = {
    _modelName: 'mock-model',

    async *generateStream() {
        yield 'Hello ';
        yield 'from ';
        yield 'mock.';
        return { usage: { inputTokens: 100, outputTokens: 40 }, costUSD: 0.05 };
    },
};
const createProviderForUserMock = vi.fn(async () => mockProvider);
vi.mock('../../lib/ai-provider.js', async (importActual) => {
    const actual = await importActual();
    return { ...actual, createProviderForUser: (...args) => createProviderForUserMock(...args) };
});

// GitHub API mock
vi.mock('../../lib/github-api.js', () => ({
    githubApi: vi.fn(async (path) => {
        if (/\/pulls\/42\/files/.test(path)) {
            return { data: [{ filename: 'src/a.js', status: 'modified', additions: 1, deletions: 0, patch: '@@' }], headers: new Map() };
        }
        if (/\/pulls\/42$/.test(path)) {
            return {
                data: {
                    number: 42, title: 'Add X', user: { login: 'alice' }, body: 'desc',
                    head: { sha: 'sha-head' }, base: { sha: 'sha-base' },
                },
                headers: new Map(),
            };
        }
        return { data: {}, headers: new Map() };
    }),
}));

const {
    default: prChatRouter,
    _resetRateLimits,
} = await import('../../routes/ai/pr-chat.js');

const USER_ID = 1;

function makeApp(userId = USER_ID) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId, accessToken: 'fake-token', login: 'alice' };
        req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
        next();
    });
    app.use('/api/ai/pr-chat', prChatRouter);
    return app;
}

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_pr_chat_messages').run();
    testDb.prepare('DELETE FROM gh_cache').run();
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    // audit_log_v2 is append-only (a trigger blocks DELETE) — don't clear it;
    // tests query by action instead.
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    createProviderForUserMock.mockReset();
    createProviderForUserMock.mockResolvedValue(mockProvider);
    _resetRateLimits();
    setTier('pro');
    delete process.env.AI_SPEND_CAP_CENTS;
});

const aiQueriesStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
function aiQueriesCount() {
    return testDb.prepare(
        "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_queries' AND period_start = ?"
    ).get(USER_ID, aiQueriesStart())?.count ?? 0;
}
function seedAiQueries(count) {
    const start = aiQueriesStart();
    const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
    testDb.prepare(
        'INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end) VALUES (?, ?, ?, ?, ?)'
    ).run(USER_ID, 'ai_queries', count, start, end);
}
function seedMetric(metricType, count) {
    const start = aiQueriesStart();
    const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
    testDb.prepare(
        'INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end) VALUES (?, ?, ?, ?, ?)'
    ).run(USER_ID, metricType, count, start, end);
}

describe('GET /api/ai/pr-chat/:owner/:repo/:pr', () => {
    it('returns the persisted history (empty initially)', async () => {
        const app = makeApp();
        const res = await request(app).get('/api/ai/pr-chat/acme/api/42');
        expect(res.status).toBe(200);
        expect(res.body.messages).toEqual([]);
    });

    it('Free tier can fetch chat history (PR Chat moved off the Pro paywall)', async () => {
        setTier('free');
        const app = makeApp();
        const res = await request(app).get('/api/ai/pr-chat/acme/api/42');
        expect(res.status).toBe(200);
    });
});

describe('POST /api/ai/pr-chat/:owner/:repo/:pr', () => {
    it('rejects an empty message with 400', async () => {
        const app = makeApp();
        const res = await request(app)
            .post('/api/ai/pr-chat/acme/api/42')
            .send({ message: '   ' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_INPUT');
    });

    it('returns 404 when no provider is configured', async () => {
        createProviderForUserMock.mockResolvedValueOnce(null);
        const app = makeApp();
        const res = await request(app)
            .post('/api/ai/pr-chat/acme/api/42')
            .send({ message: 'hi' });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NO_AI_PROVIDER');
    });

    it('Free tier can send a chat message', async () => {
        setTier('free');
        const app = makeApp();
        const res = await request(app)
            .post('/api/ai/pr-chat/acme/api/42')
            .send({ message: 'hi' });
        expect(res.status).toBe(200);
    });

    it('returns 429 QUOTA_EXCEEDED once the Free prChatMessagesPerMonth cap (100/mo) is reached (provider not called)', async () => {
        setTier('free');
        seedMetric('ai_pr_chat', 100);
        const app = makeApp();
        const res = await request(app)
            .post('/api/ai/pr-chat/acme/api/42')
            .send({ message: 'hi' });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('QUOTA_EXCEEDED');
        expect(res.body.metric).toBe('ai_pr_chat');
        expect(createProviderForUserMock).not.toHaveBeenCalled();
    });

    it('streams an SSE reply and persists user + assistant messages', async () => {
        const app = makeApp();
        const res = await request(app)
            .post('/api/ai/pr-chat/acme/api/42')
            .send({ message: 'What does this PR do?' });

        expect(res.status).toBe(200);
        // Body is SSE — supertest concatenates the chunks into res.text.
        expect(res.text).toContain('Hello ');
        expect(res.text).toContain('"done":true');

        const stored = testDb.prepare(
            'SELECT role, content FROM ai_pr_chat_messages WHERE user_id = ? ORDER BY id ASC'
        ).all(USER_ID);
        expect(stored).toHaveLength(2);
        expect(stored[0]).toEqual({ role: 'user', content: 'What does this PR do?' });
        expect(stored[1].role).toBe('assistant');
        expect(stored[1].content).toBe('Hello from mock.');
    });

    it('records monthly spend + a PII-safe audit entry after the stream completes', async () => {
        const app = makeApp();
        const res = await request(app)
            .post('/api/ai/pr-chat/acme/api/42')
            .send({ message: 'What does this PR do?' });
        expect(res.status).toBe(200);

        // costUSD 0.05 → 5 cents accumulated for the current month.
        const spendRow = testDb.prepare(
            'SELECT cents + micro_cents / 10000 AS cents FROM ai_spend WHERE user_id = ?'
        ).get(USER_ID);
        expect(spendRow?.cents).toBe(5);

        const audit = testDb.prepare(
            "SELECT action, details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.pr_chat'"
        ).get(USER_ID);
        expect(audit).toBeTruthy();
        const details = JSON.parse(audit.details);
        expect(details).toMatchObject({ feature: 'pr_chat', inputTokens: 100, outputTokens: 40 });
        // never persists the prompt or reply content
        expect(details).not.toHaveProperty('message');
        expect(JSON.stringify(details)).not.toContain('What does this PR do?');
    });

    it('returns 429 AI_SPEND_CAP_REACHED before streaming when the monthly cap is exceeded', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, month, 150);

        const app = makeApp();
        const res = await request(app)
            .post('/api/ai/pr-chat/acme/api/42')
            .send({ message: 'What does this PR do?' });

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        // The provider is never invoked and no turn is persisted.
        expect(createProviderForUserMock).not.toHaveBeenCalled();
        const stored = testDb.prepare(
            'SELECT COUNT(*) AS n FROM ai_pr_chat_messages WHERE user_id = ?'
        ).get(USER_ID);
        expect(stored.n).toBe(0);
    });

    it('meters the AI query (increments ai_queries) after a successful turn', async () => {
        const app = makeApp();
        const res = await request(app)
            .post('/api/ai/pr-chat/acme/api/42')
            .send({ message: 'What does this PR do?' });
        expect(res.status).toBe(200);
        expect(aiQueriesCount()).toBe(1);
    });

    it('returns 429 QUOTA_EXCEEDED when the monthly AI query cap is reached (provider not called)', async () => {
        seedAiQueries(10000); // Pro cap
        const app = makeApp();
        const res = await request(app)
            .post('/api/ai/pr-chat/acme/api/42')
            .send({ message: 'hi' });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('QUOTA_EXCEEDED');
        expect(createProviderForUserMock).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/ai/pr-chat/:owner/:repo/:pr', () => {
    it('clears the conversation', async () => {
        // Seed two rows directly so we don't depend on POST.
        testDb.prepare(`
            INSERT INTO ai_pr_chat_messages (user_id, repo_owner, repo_name, pr_number, role, content)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(USER_ID, 'acme', 'api', 42, 'user', 'a');
        testDb.prepare(`
            INSERT INTO ai_pr_chat_messages (user_id, repo_owner, repo_name, pr_number, role, content)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(USER_ID, 'acme', 'api', 42, 'assistant', 'b');

        const app = makeApp();
        const res = await request(app).delete('/api/ai/pr-chat/acme/api/42');
        expect(res.status).toBe(200);
        expect(res.body.cleared).toBe(2);

        const left = testDb.prepare(
            'SELECT COUNT(*) as n FROM ai_pr_chat_messages WHERE user_id = ?'
        ).get(USER_ID);
        expect(left.n).toBe(0);
    });

    it('returns 0 when nothing matches (idempotent)', async () => {
        const app = makeApp();
        const res = await request(app).delete('/api/ai/pr-chat/acme/api/42');
        expect(res.status).toBe(200);
        expect(res.body.cleared).toBe(0);
    });
});
