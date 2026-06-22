// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Integration coverage for POST /ai/readme/enhance — it must run generation
// through guardedGenerate (per-user req.aiProvider + spend cap + output cap +
// spend record + cost audit), not the server-provider-only aiService path.

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { initDB } = await vi.importActual('../../db.js');
const { makeIntegrationDb } = await import('../helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);
vi.mock('../../db.js', () => ({ default: testDb }));

const USER_ID = 1;

const fakeProvider = {
    model: 'mock-model',
    generate: vi.fn(async () => ({
        text: '## Installation\n\nnpm install lib\n',
        usage: { inputTokens: 120, outputTokens: 60 },
        costUSD: 0.04,
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

vi.mock('../../lib/github-api.js', () => ({
    githubApi: vi.fn(async (path) => {
        if (path.endsWith('/readme')) {
            return { data: { content: Buffer.from('# lib\n').toString('base64') }, headers: new Map() };
        }
        if (path.endsWith('/contents')) {
            return { data: [{ name: 'index.js', type: 'file' }], headers: new Map() };
        }
        return { data: {}, headers: new Map() };
    }),
}));

const { default: coreRouter } = await import('../../routes/ai/core.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', coreRouter);
    return app;
}

const REPO = { full_name: 'acme/api', name: 'api', language: 'JavaScript', description: 'does things' };

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    fakeProvider.generate.mockClear();
    delete process.env.AI_SPEND_CAP_CENTS;
});

describe('POST /ai/readme/enhance', () => {
    it('enhances via the per-user provider and returns sections + patterns', async () => {
        const res = await request(makeApp()).post('/ai/readme/enhance').send({ repo: REPO });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.enhancement).toContain('## Installation');
        expect(Array.isArray(res.body.missingSections)).toBe(true);
        expect(res.body.patterns).toBeDefined();
        expect(res.body.currentReadme).toBe('# lib\n');
        // Went through guardedGenerate → the per-user provider, not aiService.
        expect(fakeProvider.generate).toHaveBeenCalledTimes(1);
    });

    it('records monthly spend + a PII-safe cost audit after enhancement', async () => {
        await request(makeApp()).post('/ai/readme/enhance').send({ repo: REPO });

        const cents = testDb.prepare('SELECT cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents;
        expect(cents).toBe(4); // 0.04 USD

        const costAudit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.readme_enhance' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(costAudit).toBeTruthy();
        expect(JSON.parse(costAudit.details)).toMatchObject({ feature: 'readme_enhance', inputTokens: 120, outputTokens: 60 });
    });

    it('returns 429 AI_SPEND_CAP_REACHED when over the monthly spend cap (provider not called)', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, month, 150);

        const res = await request(makeApp()).post('/ai/readme/enhance').send({ repo: REPO });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });
});
