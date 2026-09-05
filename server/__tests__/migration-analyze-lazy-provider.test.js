// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * POST /api/migration/analyze — regression test for the lazy attachAIProvider
 * shim (B-19-adjacent). attachAIProvider() used to eagerly await
 * getAIProvider('completion') for every /api/* request and stash the result
 * on req.aiProvider/req.genAI; it now resolves lazily, populating those
 * fields only as a side effect of something actually calling
 * req.getAIProvider() (see middleware/auth.js).
 *
 * This route has no requireAI middleware — it reads req.aiProvider directly
 * to decide whether to run the AI-powered path. migration-analyze-metering.
 * test.js exercises that branch by injecting req.aiProvider straight into a
 * fake middleware, which passes regardless of whether the route itself ever
 * calls req.getAIProvider() — so it could not have caught a regression where
 * the route stopped resolving a provider at all. This suite instead wires
 * the REAL attachAIProvider() middleware so req.aiProvider only appears if
 * the route resolves it itself.
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

const fakeProvider = {
    model: 'mock-model',
    generate: vi.fn(async () => ({
        text: JSON.stringify({ executionOrder: ['repo-a'], risks: [], suggestions: [], estimatedMinutes: 5, warnings: [] }),
        usage: { inputTokens: 100, outputTokens: 40 },
        costUSD: 0.02,
    })),
};
let providerAvailable = true;
vi.mock('../lib/ai-provider.js', async (importOriginal) => ({
    ...(await importOriginal()),
    createProviderForUser: vi.fn(async () => (providerAvailable ? fakeProvider : null)),
}));

const { attachAIProvider } = await import('../middleware/auth.js');
const { default: migrationRouter } = await import('../routes/migration.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId: USER_ID, accessToken: 'ghp_test' };
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
        next();
    });
    // The real, lazy middleware — no test shim short-circuiting it.
    app.use(attachAIProvider());
    app.use('/api/migration', migrationRouter);
    return app;
}

const VALID_BODY = { repos: [{ name: 'repo-a', size: 1000, hasLfs: false }], target: { existingRepos: [] } };

function spendCents() {
    return testDb.prepare('SELECT cents + micro_cents / 10000 AS cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents ?? 0;
}

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    h.tier = 'free';
    providerAvailable = true;
    fakeProvider.generate.mockClear();
    delete process.env.AI_SPEND_CAP_CENTS;
});

describe('POST /api/migration/analyze — under the real (lazy) attachAIProvider', () => {
    it('still resolves a configured provider and runs the AI-powered path', async () => {
        const res = await request(makeApp()).post('/api/migration/analyze').send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(res.body.executionOrder).toEqual(['repo-a']);
        expect(fakeProvider.generate).toHaveBeenCalledTimes(1);
        expect(spendCents()).toBe(2);
    });

    it('falls back to deterministic analysis when no provider is configured', async () => {
        providerAvailable = false;
        const res = await request(makeApp()).post('/api/migration/analyze').send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.executionOrder)).toBe(true);
        expect(fakeProvider.generate).not.toHaveBeenCalled();
        expect(spendCents()).toBe(0);
    });
});
