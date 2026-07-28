// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Blocking-branch counterpart to dev-toolkit-stream-guards.test.js. Before
// this fix, the non-streaming branches of generate-commit, generate-pr,
// refine, analyze-context, and review-summary called the provider directly
// (`req.aiProvider.generate` / `aiService.reviewPullRequest`), bypassing the
// monthly AI spend cap entirely — `?stream` is client-chosen, so the
// unguarded blocking path was always reachable even when the streaming
// branch was fully guarded. This suite pins spend/cap parity between the two
// branches (2026-07-19 launch-readiness hardening, item A2).

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
    generate: vi.fn(),
    generateStream: vi.fn(),
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
    delete process.env.AI_SPEND_CAP_CENTS;
    fakeProvider.generate.mockReset();
    fakeProvider.generateStream.mockReset();
});

function setOverCap() {
    process.env.AI_SPEND_CAP_CENTS = '100';
    const month = new Date().toISOString().slice(0, 7);
    testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, month, 150);
}

describe('POST /ai/generate-commit (blocking)', () => {
    it('records monthly spend + the existing PII-safe audit entry on success', async () => {
        fakeProvider.generate.mockResolvedValue({
            text: JSON.stringify({ subject: 'feat: x', body: '' }),
            usage: { inputTokens: 50, outputTokens: 10 },
            costUSD: 0.03,
        });

        const res = await request(makeApp())
            .post('/ai/generate-commit')
            .send({ diff: 'a diff', format: 'conventional' });

        expect(res.status).toBe(200);
        expect(res.body.subject).toBe('feat: x');
        expect(spendCents()).toBe(3);
        expect(fakeProvider.generate.mock.calls[0][0].generationConfig.maxOutputTokens).toBeGreaterThan(0);
        const audit = auditRow('ai_generate_commit');
        expect(audit).toBeTruthy();
        expect(JSON.parse(audit.details)).toMatchObject({ format: 'conventional' });
    });

    it('returns 429 AI_SPEND_CAP_REACHED and never calls the provider when over the monthly cap', async () => {
        setOverCap();
        const res = await request(makeApp())
            .post('/ai/generate-commit')
            .send({ diff: 'a diff', format: 'conventional' });

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });
});

describe('POST /ai/generate-pr (blocking)', () => {
    it('records monthly spend on success', async () => {
        fakeProvider.generate.mockResolvedValue({
            text: JSON.stringify({ title: 'Add x', summary: 'ok', test_plan: '', breaking_changes: null, related_issues: [], suggested_labels: [], suggested_reviewers: [] }),
            usage: { inputTokens: 60, outputTokens: 20 },
            costUSD: 0.04,
        });

        const res = await request(makeApp())
            .post('/ai/generate-pr')
            .send({ commits: [{ message: 'feat: x' }], diff_summary: { files: [] }, top_patches: '' });

        expect(res.status).toBe(200);
        expect(spendCents()).toBe(4);
    });

    it('returns 429 AI_SPEND_CAP_REACHED and never calls the provider when over the monthly cap', async () => {
        setOverCap();
        const res = await request(makeApp())
            .post('/ai/generate-pr')
            .send({ commits: [{ message: 'feat: x' }], diff_summary: { files: [] }, top_patches: '' });

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });
});

describe('POST /ai/refine (blocking)', () => {
    it('records monthly spend on success', async () => {
        fakeProvider.generate.mockResolvedValue({
            text: 'refined text',
            usage: { inputTokens: 30, outputTokens: 15 },
            costUSD: 0.02,
        });

        const res = await request(makeApp())
            .post('/ai/refine')
            .send({ original_content: 'feat: x', instruction: 'shorter', content_type: 'commit' });

        expect(res.status).toBe(200);
        expect(res.body.refined_content).toBe('refined text');
        expect(spendCents()).toBe(2);
    });

    it('returns 429 AI_SPEND_CAP_REACHED and never calls the provider when over the monthly cap', async () => {
        setOverCap();
        const res = await request(makeApp())
            .post('/ai/refine')
            .send({ original_content: 'feat: x', instruction: 'shorter', content_type: 'commit' });

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });
});

describe('POST /ai/analyze-context (blocking)', () => {
    it('records monthly spend on success', async () => {
        fakeProvider.generate.mockResolvedValue({
            text: JSON.stringify({ changeType: 'feature', complexity: 'low', breakingChanges: false }),
            usage: { inputTokens: 20, outputTokens: 10 },
            costUSD: 0.01,
        });

        const res = await request(makeApp())
            .post('/ai/analyze-context')
            .send({ repo: 'acme/lib', diff_summary: { files: 1, additions: 2, deletions: 0 }, commits: [], file_list: ['a.js'] });

        expect(res.status).toBe(200);
        expect(res.body.changeType).toBe('feature');
        expect(spendCents()).toBe(1);
    });

    it('returns 429 AI_SPEND_CAP_REACHED and never calls the provider when over the monthly cap', async () => {
        setOverCap();
        // Distinct repo/diff stats so the request lands on a fresh cache key
        // (analyze-context's module-level LRU cache persists across tests in
        // this file) — otherwise this would hit the previous test's cached
        // 200 response instead of exercising the spend-cap gate.
        const res = await request(makeApp())
            .post('/ai/analyze-context')
            .send({ repo: 'acme/over-cap-repo', diff_summary: { files: 9, additions: 99, deletions: 9 }, commits: [], file_list: ['b.js'] });

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });
});

describe('POST /ai/review-summary (blocking)', () => {
    it('records monthly spend + audit on success', async () => {
        fakeProvider.generate.mockResolvedValue({
            parsed: { overview: 'ok', riskLevel: 'low', keyChanges: [], fileRisks: [], suggestedReviewOrder: [], estimatedReviewTime: '5m' },
            usage: { inputTokens: 40, outputTokens: 20 },
            costUSD: 0.05,
        });

        const res = await request(makeApp())
            .post('/ai/review-summary')
            .send({ fileManifest: [], topFilePatches: [], prMetadata: { title: 'PR', additions: 1, deletions: 0, repo: 'a/b', number: 5 } });

        expect(res.status).toBe(200);
        expect(res.body.summary.overview).toBe('ok');
        expect(spendCents()).toBe(5);
        expect(auditRow('ai.review_summary')).toBeTruthy();
    });

    it('returns 429 AI_SPEND_CAP_REACHED and never calls the provider when over the monthly cap', async () => {
        setOverCap();
        const res = await request(makeApp())
            .post('/ai/review-summary')
            .send({ fileManifest: [], topFilePatches: [], prMetadata: { title: 'PR', additions: 1, deletions: 0, repo: 'a/b', number: 5 } });

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });
});
