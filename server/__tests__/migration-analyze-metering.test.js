// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * POST /api/migration/analyze — full AI metering (2026-07-19 launch-readiness
 * hardening, item A1). Before this fix the route called
 * `aiService.provider.generate()` directly: no quota, no spend cap, no
 * output-token cap, no requireScope('ai') — a prompt inflatable to 200 repos
 * was an unmetered denial-of-wallet vector on the server key.
 *
 * This suite pins:
 *  - requireScope('ai') gates the route (mirrors every other AI route)
 *  - the ai_migration_risk quota is checked before, and charged only after, a
 *    real AI attempt
 *  - the monthly spend cap is checked BEFORE any provider call and returns
 *    the canonical 429 envelope — no unmetered provider call is possible
 *  - a provider failure (non-spend-cap) still degrades to fallbackAnalysis
 *    (200), matching this endpoint's pre-existing reliability contract
 *  - when no AI provider is available at all, the endpoint is fully
 *    unmetered (zero quota/spend cost) — same as before this route had any
 *    AI capability wired in
 */
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { initDB } = await vi.importActual('../db.js');
const { makeIntegrationDb } = await import('./helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);
vi.mock('../db.js', () => ({ default: testDb }));

const USER_ID = 1;

const h = vi.hoisted(() => ({ tier: 'free' }));
vi.mock('../middleware/require-tier.js', () => ({ getUserTier: () => h.tier }));

// Heavy migration-engine graph the route module pulls in transitively — inert
// stubs, none of this is exercised by /analyze itself.
vi.mock('../migration-engine.js', () => ({
    MigrationEngine: class {
        constructor() { this.credentials = { retrieve: () => null, forget: () => {} }; }
        on() { return this; }
    },
}));
vi.mock('../migration-tagging-service.js', () => ({ createMigrationTaggingService: () => ({}) }));
vi.mock('../lib/tagging/github-writer.js', () => ({ createGithubWriter: () => ({}) }));
vi.mock('../lib/tagging/azure-writer.js', () => ({ createAzureWriter: () => ({}) }));
vi.mock('../lib/tagging/git-tag-writer.js', () => ({ createGitTagWriter: () => ({}) }));
vi.mock('../lib/tagging/http-shim.js', () => ({ createHttpShim: () => ({}) }));
vi.mock('../lib/tagging/tagging-workdir-resolver.js', () => ({ createTaggingWorkdirResolver: () => () => null }));
vi.mock('../lib/migration-plan-complete.js', () => ({ handlePlanComplete: () => {} }));
vi.mock('../lib/azure-credentials-manager.js', () => ({ decryptForUse: () => null }));

const { default: migrationRouter } = await import('../routes/migration.js');

// Configurable per-test — null means "no AI configured" (mirrors req.aiProvider
// being unset when attachAIProvider() couldn't resolve a provider).
let fakeProvider = null;

function makeApp({ apiKeyScopes } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId: USER_ID, accessToken: 'ghp_test' };
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
        req.aiProvider = fakeProvider;
        // Simulate an API-key-authenticated request (bypassing the full
        // apiKeyAuth chain, which is covered end-to-end elsewhere) so
        // requireScope('ai')'s own branch can be exercised directly.
        if (apiKeyScopes) {
            req.apiKeyId = 'key-1';
            req.scopes = apiKeyScopes;
        }
        next();
    });
    app.use('/api/migration', migrationRouter);
    return app;
}

const VALID_BODY = { repos: [{ name: 'repo-a', size: 1000, hasLfs: false }], target: { existingRepos: [] } };

function spendCents() {
    return testDb.prepare('SELECT cents + micro_cents / 10000 AS cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents ?? 0;
}
function migrationRiskUsageCount() {
    return testDb.prepare(
        "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_migration_risk'"
    ).get(USER_ID)?.count ?? 0;
}

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    h.tier = 'free';
    fakeProvider = null;
    delete process.env.AI_SPEND_CAP_CENTS;
});

describe('POST /api/migration/analyze — scope enforcement', () => {
    it('403s an API-key request that lacks the ai/admin scope, naming the missing scope', async () => {
        const res = await request(makeApp({ apiKeyScopes: ['write'] }))
            .post('/api/migration/analyze')
            .send(VALID_BODY);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: 'Insufficient permissions', required: 'ai' });
    });

    it('allows an API-key request carrying the ai scope', async () => {
        const res = await request(makeApp({ apiKeyScopes: ['ai'] }))
            .post('/api/migration/analyze')
            .send(VALID_BODY);

        expect(res.status).toBe(200);
    });

    it('allows a plain session user (no apiKeyId) regardless of scopes', async () => {
        const res = await request(makeApp())
            .post('/api/migration/analyze')
            .send(VALID_BODY);

        expect(res.status).toBe(200);
    });
});

describe('POST /api/migration/analyze — no AI provider configured', () => {
    it('returns a deterministic fallback analysis without touching quota or spend', async () => {
        fakeProvider = null;
        const res = await request(makeApp()).post('/api/migration/analyze').send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.executionOrder)).toBe(true);
        expect(res.body.aiUsed).toBeUndefined();
        expect(spendCents()).toBe(0);
        expect(migrationRiskUsageCount()).toBe(0);
    });
});

describe('POST /api/migration/analyze — AI-powered path', () => {
    it('charges ai_migration_risk quota and records spend on a successful AI analysis', async () => {
        fakeProvider = {
            model: 'mock-model',
            generate: vi.fn(async () => ({
                text: JSON.stringify({ executionOrder: ['repo-a'], risks: [], suggestions: [], estimatedMinutes: 5, warnings: [] }),
                usage: { inputTokens: 100, outputTokens: 40 },
                costUSD: 0.02,
            })),
        };

        const res = await request(makeApp()).post('/api/migration/analyze').send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(res.body.executionOrder).toEqual(['repo-a']);
        expect(res.body.aiUsed).toBeUndefined();
        expect(fakeProvider.generate).toHaveBeenCalledTimes(1);
        // The output-token cap is injected by guardedGenerate — never left to
        // the raw provider call.
        expect(fakeProvider.generate.mock.calls[0][0].generationConfig.maxOutputTokens).toBeGreaterThan(0);
        expect(spendCents()).toBe(2); // 0.02 USD
        expect(migrationRiskUsageCount()).toBe(1);
    });

    it('returns the canonical 429 AI_SPEND_CAP_REACHED envelope and never calls the provider when over the monthly cap', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, month, 150);
        fakeProvider = { model: 'mock-model', generate: vi.fn(async () => ({ text: '{}' })) };

        const res = await request(makeApp()).post('/api/migration/analyze').send(VALID_BODY);

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
        expect(migrationRiskUsageCount()).toBe(0);
    });

    it('returns 429 QUOTA_EXCEEDED without calling the provider when the ai_migration_risk quota is exhausted', async () => {
        const now = new Date();
        const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
        // Free tier's migrationRiskPerMonth cap is 25 (server/lib/feature-flags.js).
        testDb.prepare(
            'INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end) VALUES (?, ?, ?, ?, ?)'
        ).run(USER_ID, 'ai_migration_risk', 25, periodStart, periodEnd);
        fakeProvider = { model: 'mock-model', generate: vi.fn(async () => ({ text: '{}' })) };

        const res = await request(makeApp()).post('/api/migration/analyze').send(VALID_BODY);

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('QUOTA_EXCEEDED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });

    it('degrades gracefully to the deterministic fallback (200) on a non-spend-cap provider failure, without charging quota', async () => {
        fakeProvider = {
            model: 'mock-model',
            generate: vi.fn(async () => { throw new Error('upstream timeout'); }),
        };

        const res = await request(makeApp()).post('/api/migration/analyze').send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.executionOrder)).toBe(true);
        expect(spendCents()).toBe(0);
        expect(migrationRiskUsageCount()).toBe(0);
    });
});

describe('POST /api/migration/analyze — input validation (unchanged)', () => {
    it('400s when repos is missing', async () => {
        const res = await request(makeApp()).post('/api/migration/analyze').send({});
        expect(res.status).toBe(400);
    });

    it('400s when repos exceeds 200 entries', async () => {
        const repos = Array.from({ length: 201 }, (_, i) => ({ name: `r${i}`, size: 1 }));
        const res = await request(makeApp()).post('/api/migration/analyze').send({ repos });
        expect(res.status).toBe(400);
    });
});
