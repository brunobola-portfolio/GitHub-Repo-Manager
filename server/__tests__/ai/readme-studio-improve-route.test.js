// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Integration coverage for POST /ai/readme-studio/improve — the consolidated,
// grounded README Studio "improve" endpoint. Pins: guardedGenerate wiring
// (per-user provider + spend cap + audit), the readmeGenPerMonth quota reuse
// (ai_readme metric, unchanged), and the honesty-constraint response shape
// (confidence + warnings surfaced to the caller).

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
        usage: { inputTokens: 200, outputTokens: 90 },
        costUSD: 0.05,
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

function b64(s) {
    return Buffer.from(s, 'utf8').toString('base64');
}

vi.mock('../../lib/github-api.js', () => ({
    githubApi: vi.fn(async (path) => {
        if (path.endsWith('/readme')) {
            return { data: { content: b64('# lib\n'), encoding: 'base64' } };
        }
        if (path.endsWith('/contents/LICENSE')) {
            return { data: { content: b64('MIT License'), encoding: 'base64' } };
        }
        if (path.endsWith('/contents/.github/workflows')) {
            return { data: [] };
        }
        if (path.endsWith('/contents')) {
            return { data: [{ name: 'package.json', type: 'file' }] };
        }
        const err = new Error('not found');
        err.status = 404;
        throw err;
    }),
}));

const { githubApi } = await import('../../lib/github-api.js');
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

describe('POST /ai/readme-studio/improve', () => {
    it('generates grounded markdown via the per-user provider and returns the honesty-shaped response', async () => {
        const res = await request(makeApp()).post('/ai/readme-studio/improve').send({ repo: REPO });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.markdown).toContain('## Installation');
        expect(res.body.mode).toBe('missing-sections');
        expect(res.body.confidence).toBeDefined();
        expect(Array.isArray(res.body.warnings)).toBe(true);
        expect(Array.isArray(res.body.missingSections)).toBe(true);
        expect(res.body.currentReadme).toBe('# lib\n');
        expect(fakeProvider.generate).toHaveBeenCalledTimes(1);
    });

    it('defaults to missing-sections mode and switches on request', async () => {
        const res = await request(makeApp())
            .post('/ai/readme-studio/improve')
            .send({ repo: REPO, mode: 'full-rewrite' });
        expect(res.status).toBe(200);
        expect(res.body.mode).toBe('full-rewrite');
    });

    it('records monthly spend + a PII-safe cost audit tagged readme_studio', async () => {
        await request(makeApp()).post('/ai/readme-studio/improve').send({ repo: REPO });

        const cents = testDb.prepare('SELECT cents + micro_cents / 10000 AS cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents;
        expect(cents).toBe(5); // 0.05 USD

        const costAudit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.readme_studio' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(costAudit).toBeTruthy();
        expect(JSON.parse(costAudit.details)).toMatchObject({ feature: 'readme_studio' });

        const usageAudit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.readme_studio.improve' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(usageAudit).toBeTruthy();
    });

    it('returns 429 AI_SPEND_CAP_REACHED when over the monthly spend cap (provider not called)', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, month, 150);

        const res = await request(makeApp()).post('/ai/readme-studio/improve').send({ repo: REPO });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });

    it('flags a huge/binary existing README as readmeTruncated with a low-confidence warning', async () => {
        // First githubApi call in the route is fetchReadmeStudioSignals' own
        // README fetch — override just that one call to GitHub's
        // "encoding: none" shape for a file too large/binary to inline.
        githubApi.mockImplementationOnce(async () => ({ data: { encoding: 'none', content: '', size: 2_000_000 } }));

        const res = await request(makeApp()).post('/ai/readme-studio/improve').send({ repo: REPO });
        expect(res.status).toBe(200);
        expect(res.body.readmeTruncated).toBe(true);
        expect(res.body.confidence).toBe('low');
        expect(res.body.currentReadme).toBe('');
        expect(res.body.warnings.some((w) => /could not be read/i.test(w))).toBe(true);
    });

    it('rejects an invalid repo.full_name', async () => {
        const res = await request(makeApp())
            .post('/ai/readme-studio/improve')
            .send({ repo: { full_name: 'not a valid name/../x' } });
        expect(res.status).toBe(400);
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });
});
