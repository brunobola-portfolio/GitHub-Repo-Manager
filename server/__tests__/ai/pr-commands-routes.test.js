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

// --- Tier middleware mock --------------------------------------------------
let currentTier = 'pro';
function setTier(t) { currentTier = t; }
const TIER_ORDER = { free: 0, pro: 1, enterprise: 2 };
vi.mock('../../middleware/require-tier.js', () => ({
    requireTier: (minTier) => (req, res, next) => {
        const min = TIER_ORDER[minTier] ?? 0;
        const have = TIER_ORDER[currentTier] ?? 0;
        if (have >= min) return next();
        return res.status(403).json({
            error: 'upgrade_required',
            message: `This feature requires the ${minTier} plan`,
            currentTier,
            requiredTier: minTier,
        });
    },
    getUserTier: () => currentTier,
    attachTier: (req, _res, next) => { req.userTier = currentTier; next(); },
}));

// --- AI provider mock ------------------------------------------------------
const sampleByCommand = {
    describe: { title: 'Improved title', body: '## Overview\nDescribes the change.\n## What changed\n- foo' },
    test_plan: {
        summary: 'one case',
        cases: [{ name: 'a', type: 'unit', steps: ['Given', 'When', 'Then'], priority: 'high' }],
    },
    improve: {
        summary: 'one suggestion',
        suggestions: [{ path: 'src/a.js', line: 1, severity: 'warning', body: 'use ===' }],
    },
};

const usageMeta = { usage: { inputTokens: 150, outputTokens: 60 }, costUSD: 0.04 };
const mockGenerate = vi.fn(async (args) => {
    // Detect which command we're running by looking at the schema's required fields.
    const required = args?.schema?.required || [];
    if (required.includes('cases')) return { parsed: sampleByCommand.test_plan, ...usageMeta };
    if (required.includes('suggestions')) return { parsed: sampleByCommand.improve, ...usageMeta };
    return { parsed: sampleByCommand.describe, ...usageMeta };
});

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

// --- GitHub API mock -------------------------------------------------------
const githubApiMock = vi.fn(async (path /* , token, options */) => {
    if (path.includes('/pulls/42/files')) {
        return {
            data: [{ filename: 'src/a.js', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '@@ ... @@' }],
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
    return { data: { id: 9999, title: 'Improved title', body: 'new body' }, headers: new Map() };
});
vi.mock('../../lib/github-api.js', () => ({
    githubApi: (...args) => githubApiMock(...args),
}));

// --- Outbox helper mock ----------------------------------------------------
// Capture every call so tests can assert on the idempotency key construction.
const executeViaOutboxMock = vi.fn(async (_req, opts) => ({
    data: { id: 9999, title: 'Improved title', body: opts?.body?.body ?? 'new body' },
}));
vi.mock('../../lib/outbox-helper.js', () => ({
    executeViaOutbox: (...args) => executeViaOutboxMock(...args),
}));

const {
    default: prCommandsRouter,
    _resetRateLimits,
} = await import('../../routes/ai/pr-commands.js');

const USER_ID = 1;

function makeApp(userId = USER_ID) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId, accessToken: 'fake-token', login: 'alice' };
        req.log = { error: () => {}, warn: () => {}, info: () => {} };
        next();
    });
    app.use('/api/ai/pr-commands', prCommandsRouter);
    return app;
}

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_pr_commands').run();
    testDb.prepare('DELETE FROM gh_outbox').run();
    testDb.prepare('DELETE FROM gh_cache').run();
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    githubApiMock.mockClear();
    mockGenerate.mockClear();
    executeViaOutboxMock.mockClear();
    createProviderForUserMock.mockReset();
    createProviderForUserMock.mockResolvedValue(mockProvider);
    _resetRateLimits();
    setTier('pro');
    delete process.env.AI_SPEND_CAP_CENTS;
});

const monthKey = () => new Date().toISOString().slice(0, 7);
function aiQueriesCount() {
    const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
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

describe('POST /api/ai/pr-commands/:owner/:repo/:pr/:command', () => {
    it('generates and persists a /describe result', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        expect(res.status).toBe(200);
        expect(res.body.id).toBeGreaterThan(0);
        expect(res.body.command).toBe('describe');
        expect(res.body.output.title).toBe('Improved title');
        expect(res.body.output.body).toMatch(/Overview/);
        expect(res.body.lastHeadSha).toBe('sha-head');
    });

    it('generates a /test_plan result with cases', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/test_plan').send({});
        expect(res.status).toBe(200);
        expect(res.body.command).toBe('test_plan');
        expect(res.body.output.cases).toHaveLength(1);
        expect(res.body.output.cases[0].priority).toBe('high');
    });

    it('generates an /improve result with suggestions', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/improve').send({});
        expect(res.status).toBe(200);
        expect(res.body.command).toBe('improve');
        expect(res.body.output.suggestions).toHaveLength(1);
        expect(res.body.output.suggestions[0].severity).toBe('warning');
    });

    it('rejects unknown command with 400', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/explain').send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_COMMAND');
    });

    it('returns 404 when no provider is configured', async () => {
        createProviderForUserMock.mockResolvedValueOnce(null);
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NO_AI_PROVIDER');
    });

    it('meters the AI query (increments ai_queries) on success', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        expect(res.status).toBe(200);
        expect(aiQueriesCount()).toBe(1);
    });

    it('records monthly spend + a PII-safe audit entry after generation', async () => {
        const app = makeApp();
        await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});

        const cents = testDb.prepare('SELECT cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents;
        expect(cents).toBe(4); // 0.04 USD

        const audit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.pr_command' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(audit).toBeTruthy();
        const details = JSON.parse(audit.details);
        expect(details).toMatchObject({ feature: 'pr_command', command: 'describe', inputTokens: 150, outputTokens: 60 });
    });

    it('returns 429 QUOTA_EXCEEDED when the monthly AI query cap is reached (provider not called)', async () => {
        seedAiQueries(5000);
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('QUOTA_EXCEEDED');
        expect(createProviderForUserMock).not.toHaveBeenCalled();
    });

    it('returns 429 AI_SPEND_CAP_REACHED when over the monthly spend cap (provider not called)', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, monthKey(), 150);
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(createProviderForUserMock).not.toHaveBeenCalled();
    });

    it('returns 403 for free tier (Pro feature)', async () => {
        setTier('free');
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('upgrade_required');
    });
});

describe('GET /api/ai/pr-commands/:owner/:repo/:pr/:command', () => {
    it('returns the cached result with no LLM call', async () => {
        const app = makeApp();
        await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        mockGenerate.mockClear();
        const res = await request(app).get('/api/ai/pr-commands/acme/api/42/describe');
        expect(res.status).toBe(200);
        expect(res.body.command).toBe('describe');
        expect(res.body.output.title).toBe('Improved title');
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('returns 404 when nothing is cached', async () => {
        const app = makeApp();
        const res = await request(app).get('/api/ai/pr-commands/acme/api/42/describe');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
    });

    it('returns 403 for free tier', async () => {
        setTier('free');
        const app = makeApp();
        const res = await request(app).get('/api/ai/pr-commands/acme/api/42/describe');
        expect(res.status).toBe(403);
    });
});

describe('DELETE /api/ai/pr-commands/:owner/:repo/:pr/:command', () => {
    it('deletes a cached result', async () => {
        const app = makeApp();
        await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        const res = await request(app).delete('/api/ai/pr-commands/acme/api/42/describe');
        expect(res.status).toBe(204);
        const after = await request(app).get('/api/ai/pr-commands/acme/api/42/describe');
        expect(after.status).toBe(404);
    });

    it('returns 404 when nothing matches', async () => {
        const app = makeApp();
        const res = await request(app).delete('/api/ai/pr-commands/acme/api/42/describe');
        expect(res.status).toBe(404);
    });
});

describe('POST /api/ai/pr-commands/:owner/:repo/:pr/describe/publish', () => {
    it('PATCHes the PR body via GitHub when a describe result exists', async () => {
        const app = makeApp();
        await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/describe/publish').send({});
        expect(res.status).toBe(200);
        expect(res.body.bodyApplied).toBe(true);
        // Verify PATCH /repos/.../pulls/42 was dispatched through the outbox
        const patchCall = executeViaOutboxMock.mock.calls.find(
            ([, opts]) => opts?.method === 'PATCH' && /\/pulls\/42$/.test(opts?.url || ''),
        );
        expect(patchCall).toBeTruthy();
    });

    it('returns 404 when no describe result exists', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/describe/publish').send({});
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
    });

    it('returns 403 for free tier', async () => {
        setTier('free');
        const app = makeApp();
        const res = await request(app).post('/api/ai/pr-commands/acme/api/42/describe/publish').send({});
        expect(res.status).toBe(403);
    });

    it('produces a different idempotency key when the describe body changes between publishes', async () => {
        const app = makeApp();
        // First generate + publish with body A.
        mockGenerate.mockResolvedValueOnce({
            parsed: { title: 'T1', body: '## First body content version A' },
        });
        await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        const pub1 = await request(app).post('/api/ai/pr-commands/acme/api/42/describe/publish').send({});
        expect(pub1.status).toBe(200);

        // Re-generate the SAME (owner, repo, pr, command) cell with a fresh
        // body. The DB row id stays the same (UPSERT), and the head SHA from
        // the GitHub mock is unchanged — so without a body-aware idempotency
        // key, the second publish would silently dedupe.
        mockGenerate.mockResolvedValueOnce({
            parsed: { title: 'T2', body: '## Second body content version B - completely different' },
        });
        await request(app).post('/api/ai/pr-commands/acme/api/42/describe').send({});
        const pub2 = await request(app).post('/api/ai/pr-commands/acme/api/42/describe/publish').send({});
        expect(pub2.status).toBe(200);

        // Both publishes reached the outbox helper.
        const patchCalls = executeViaOutboxMock.mock.calls.filter(
            ([, opts]) => opts?.method === 'PATCH' && /\/pulls\/42$/.test(opts?.url || ''),
        );
        expect(patchCalls).toHaveLength(2);

        const key1 = patchCalls[0][1].idempotencyKey;
        const key2 = patchCalls[1][1].idempotencyKey;
        expect(key1).toMatch(/^pr-command-describe:\d+:[^:]+:[a-f0-9]{12}$/);
        expect(key2).toMatch(/^pr-command-describe:\d+:[^:]+:[a-f0-9]{12}$/);
        expect(key1).not.toBe(key2);
    });
});
