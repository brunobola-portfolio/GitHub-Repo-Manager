// SPDX-License-Identifier: Apache-2.0
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
// `requireTier('pro')` reads from the licensing/Stripe stack which we don't
// want to spin up in unit tests. Stub it with a per-test toggle: when
// `currentTier` is below 'pro' the middleware short-circuits with the same
// 403 envelope the real one emits.
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
const mockGenerate = vi.fn(async () => ({
    parsed: {
        walkthrough: {
            summary: 'AI summary',
            perFileTable: [{ path: 'src/sample.js', change: 'modified', summary: 'tweaked' }],
            mermaid: '',
            estimatedReviewTime: '1 min',
            riskLevel: 'low',
        },
        lineComments: [
            { path: 'src/sample.js', side: 'RIGHT', line: 1, severity: 'info', body: 'use ===' },
        ],
    },
    usage: { inputTokens: 90, outputTokens: 30 },
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

// --- Org membership mock ---------------------------------------------------
// Slice 5: GET /presets and POST /presets (scope=org) consult these helpers
// to gate visibility / write authorization. Tests drive them per-case.
const orgMembershipMocks = {
    isOrgMember: vi.fn(async () => false),
    getCurrentUserOrgs: vi.fn(async () => []),
    filterOrgsByMembership: vi.fn(async ({ orgs }) => orgs ?? []),
};
vi.mock('../../lib/github-org-membership.js', () => orgMembershipMocks);

// --- Resolver mock ---------------------------------------------------------
// We mock the resolver instead of `runDeepReview` so we can both:
//   (a) assert the route plumbed the right preset key down to the resolver, and
//   (b) still let the engine run end-to-end on the mock provider above
//       (it only consumes `resolvedPrompt.systemPrompt` etc).
const resolveMock = vi.fn(async ({ presetKey }) => ({
    name: presetKey === 'security' ? 'Security audit' : 'General',
    systemPrompt: 'system prompt body',
    severityFloor: null,
    pathRules: [],
    source: presetKey ? `preset:${presetKey}` : 'fallback',
}));
vi.mock('../../lib/ai-features/prompt-registry.js', () => ({
    resolvePromptForGenerate: (...args) => resolveMock(...args),
}));

const {
    default: promptStudioRouter,
    _resetTestBuckets,
} = await import('../../routes/ai/prompt-studio.js');
const { savePreset } = await import('../../lib/ai-prompt-store.js');

const USER_ID = 1001;
const OTHER_USER_ID = 1002;

function makeApp(userId = USER_ID) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId, accessToken: 'fake-token', login: 'alice' };
        // POST /presets' promptPresetsMax count-check reads req.userTier
        // directly (mirrors server/index.js's globally-mounted attachTier
        // middleware in production — see teams.integration.test.js for the
        // same convention).
        req.userTier = currentTier;
        req.log = { error: () => {}, warn: () => {}, info: () => {} };
        next();
    });
    app.use('/api/ai/prompt-studio', promptStudioRouter);
    return app;
}

const monthKey = () => new Date().toISOString().slice(0, 7);
const aiQueriesStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
function aiQueriesCount(uid = USER_ID) {
    return testDb.prepare(
        "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_queries' AND period_start = ?"
    ).get(uid, aiQueriesStart())?.count ?? 0;
}
function seedAiQueries(count, uid = USER_ID) {
    const start = aiQueriesStart();
    const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
    testDb.prepare(
        'INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end) VALUES (?, ?, ?, ?, ?)'
    ).run(uid, 'ai_queries', count, start, end);
}
function seedMetric(metricType, count, uid = USER_ID) {
    const start = aiQueriesStart();
    const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
    testDb.prepare(
        'INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end) VALUES (?, ?, ?, ?, ?)'
    ).run(uid, metricType, count, start, end);
}

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_review_prompts').run();
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    delete process.env.AI_SPEND_CAP_CENTS;
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(OTHER_USER_ID, 'bob');
    mockGenerate.mockClear();
    createProviderForUserMock.mockReset();
    createProviderForUserMock.mockResolvedValue(mockProvider);
    resolveMock.mockClear();
    orgMembershipMocks.isOrgMember.mockReset().mockResolvedValue(false);
    orgMembershipMocks.getCurrentUserOrgs.mockReset().mockResolvedValue([]);
    orgMembershipMocks.filterOrgsByMembership
        .mockReset()
        .mockImplementation(async ({ orgs }) => orgs ?? []);
    setTier('pro');
    _resetTestBuckets();
});

describe('GET /api/ai/prompt-studio/presets', () => {
    it('returns 5 built-ins plus the user\'s custom presets', async () => {
        savePreset(USER_ID, {
            scope: 'user', scopeTarget: null, presetKey: 'mine-1',
            name: 'My preset', systemPrompt: 'Be strict', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        const res = await request(makeApp()).get('/api/ai/prompt-studio/presets');
        expect(res.status).toBe(200);
        const builtins = res.body.presets.filter((p) => p.builtin);
        const custom = res.body.presets.filter((p) => !p.builtin);
        expect(builtins).toHaveLength(5);
        expect(builtins.map((b) => b.id).sort()).toEqual(
            ['accessibility', 'general', 'performance', 'refactor', 'security'],
        );
        expect(custom).toHaveLength(1);
        expect(custom[0].name).toBe('My preset');
    });

    it('does not leak other users\' custom presets', async () => {
        savePreset(OTHER_USER_ID, {
            scope: 'user', scopeTarget: null, presetKey: 'theirs',
            name: 'Their preset', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        const res = await request(makeApp()).get('/api/ai/prompt-studio/presets');
        expect(res.status).toBe(200);
        expect(res.body.presets.filter((p) => !p.builtin)).toHaveLength(0);
    });
});

describe('GET /api/ai/prompt-studio/presets/:id', () => {
    it('returns the built-in body for a built-in key', async () => {
        const res = await request(makeApp()).get('/api/ai/prompt-studio/presets/general');
        expect(res.status).toBe(200);
        expect(res.body.builtin).toBe(true);
        expect(res.body.name).toBe('General');
        expect(typeof res.body.body).toBe('string');
        expect(res.body.body.length).toBeGreaterThan(0);
    });

    it('returns the owned custom preset by numeric id', async () => {
        const id = savePreset(USER_ID, {
            scope: 'user', scopeTarget: null, presetKey: 'mine',
            name: 'Mine', systemPrompt: 'body', pathRules: [],
            severityFloor: 'warning', isDefault: false,
        });
        const res = await request(makeApp()).get(`/api/ai/prompt-studio/presets/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.builtin).toBe(false);
        expect(res.body.name).toBe('Mine');
        expect(res.body.body).toBe('body');
        expect(res.body.severityFloor).toBe('warning');
    });

    it('enforces ownership — 404 when caller does not own the row', async () => {
        const id = savePreset(OTHER_USER_ID, {
            scope: 'user', scopeTarget: null, presetKey: 'theirs',
            name: 'Theirs', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        const res = await request(makeApp(USER_ID)).get(`/api/ai/prompt-studio/presets/${id}`);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
    });

    it('400 for an invalid id shape', async () => {
        const res = await request(makeApp()).get('/api/ai/prompt-studio/presets/not-a-key-or-number!!');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_PARAM');
    });
});

describe('POST /api/ai/prompt-studio/presets', () => {
    const validBody = {
        scope: 'user',
        scopeTarget: null,
        presetKey: 'my-custom',
        name: 'My custom',
        systemPrompt: 'Look for SQL injection',
        pathRules: [{ glob: 'src/**', extraPrompt: 'Be strict' }],
        severityFloor: 'warning',
    };

    it('Free tier can create a custom preset (Prompt Studio moved off the Pro paywall)', async () => {
        setTier('free');
        const res = await request(makeApp()).post('/api/ai/prompt-studio/presets').send(validBody);
        expect(res.status).toBe(201);
        expect(res.body.id).toBeGreaterThan(0);
    });

    it('returns 403 once the Free promptPresetsMax cap (10) is reached', async () => {
        setTier('free');
        for (let i = 0; i < 10; i++) {
            savePreset(USER_ID, {
                scope: 'user', scopeTarget: null, presetKey: `mine-${i}`,
                name: `Mine ${i}`, systemPrompt: 'x', pathRules: [],
                severityFloor: null, isDefault: false,
            });
        }
        const res = await request(makeApp()).post('/api/ai/prompt-studio/presets').send(validBody);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('tier_limit_exceeded');
    });

    it('Pro user creates a custom preset → 201 with id', async () => {
        const res = await request(makeApp()).post('/api/ai/prompt-studio/presets').send(validBody);
        expect(res.status).toBe(201);
        expect(res.body.id).toBeGreaterThan(0);
    });

    it('rejects reserved built-in key (presetKey: "general") → 409 RESERVED_KEY', async () => {
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets')
            .send({ ...validBody, presetKey: 'general' });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('RESERVED_KEY');
    });

    it('rejects body with missing required fields → 400 validation_failed', async () => {
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets')
            .send({ scope: 'user' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects scope=repo without scopeTarget → 400', async () => {
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets')
            .send({ ...validBody, scope: 'repo', scopeTarget: null });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });
});

describe('PATCH /api/ai/prompt-studio/presets/:id', () => {
    it('Pro user updates an owned preset → 200', async () => {
        const id = savePreset(USER_ID, {
            scope: 'user', scopeTarget: null, presetKey: 'mine',
            name: 'Old name', systemPrompt: 'old', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        const res = await request(makeApp())
            .patch(`/api/ai/prompt-studio/presets/${id}`)
            .send({ name: 'New name', systemPrompt: 'new body' });
        expect(res.status).toBe(200);
        expect(res.body.changes).toBe(1);
    });

    it('Free tier can edit an owned preset', async () => {
        const id = savePreset(USER_ID, {
            scope: 'user', scopeTarget: null, presetKey: 'mine',
            name: 'X', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        setTier('free');
        const res = await request(makeApp())
            .patch(`/api/ai/prompt-studio/presets/${id}`)
            .send({ name: 'New' });
        expect(res.status).toBe(200);
    });

    it('returns 404 for an id the caller does not own', async () => {
        const id = savePreset(OTHER_USER_ID, {
            scope: 'user', scopeTarget: null, presetKey: 'theirs',
            name: 'X', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        const res = await request(makeApp(USER_ID))
            .patch(`/api/ai/prompt-studio/presets/${id}`)
            .send({ name: 'Hijacked' });
        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/ai/prompt-studio/presets/:id', () => {
    it('Pro user deletes an owned preset → 204', async () => {
        const id = savePreset(USER_ID, {
            scope: 'user', scopeTarget: null, presetKey: 'mine',
            name: 'X', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        const res = await request(makeApp()).delete(`/api/ai/prompt-studio/presets/${id}`);
        expect(res.status).toBe(204);
    });

    it('returns 404 for unknown id', async () => {
        const res = await request(makeApp()).delete('/api/ai/prompt-studio/presets/9999999');
        expect(res.status).toBe(404);
    });
});

describe('POST /api/ai/prompt-studio/presets/:id/set-default', () => {
    it('marks the preset as the scope default', async () => {
        const id = savePreset(USER_ID, {
            scope: 'user', scopeTarget: null, presetKey: 'mine',
            name: 'X', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        const res = await request(makeApp())
            .post(`/api/ai/prompt-studio/presets/${id}/set-default`).send({});
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(id);
        const row = testDb.prepare('SELECT is_default FROM ai_review_prompts WHERE id = ?').get(id);
        expect(row.is_default).toBe(1);
    });

    it('returns 404 for unknown id', async () => {
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/9999999/set-default').send({});
        expect(res.status).toBe(404);
    });
});

describe('POST /api/ai/prompt-studio/presets/:id/test', () => {
    it('Pro user gets sample result + presetSource label', async () => {
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/security/test').send({});
        expect(res.status).toBe(200);
        expect(res.body.presetName).toBe('Security audit');
        expect(res.body.source).toBe('preset:security');
        expect(res.body.sample.walkthrough.summary).toBe('AI summary');
        expect(res.body.sample.lineComments).toHaveLength(1);
        expect(resolveMock).toHaveBeenCalledWith(expect.objectContaining({
            presetKey: 'security',
            userId: USER_ID,
        }));
    });

    it('Free tier can run /test (Prompt Studio moved off the Pro paywall)', async () => {
        setTier('free');
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/general/test').send({});
        expect(res.status).toBe(200);
    });

    it('returns 429 QUOTA_EXCEEDED once the Free promptStudioTestPerMonth cap (30/mo) is reached (provider not called)', async () => {
        setTier('free');
        seedMetric('ai_prompt_test', 30);
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/general/test').send({});
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('QUOTA_EXCEEDED');
        expect(res.body.metric).toBe('ai_prompt_test');
        expect(createProviderForUserMock).not.toHaveBeenCalled();
    });

    it('returns 404 when no AI provider is configured', async () => {
        createProviderForUserMock.mockResolvedValueOnce(null);
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/general/test').send({});
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NO_AI_PROVIDER');
    });

    it('rate-limits a second call within 10s → 429', async () => {
        const first = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/general/test').send({});
        expect(first.status).toBe(200);
        const second = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/general/test').send({});
        expect(second.status).toBe(429);
        expect(second.body.code).toBe('RATE_LIMITED');
        expect(second.headers['retry-after']).toBeDefined();
    });

    it('surfaces resolver PRESET_NOT_FOUND as 404', async () => {
        resolveMock.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'PRESET_NOT_FOUND' }));
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/12345/test').send({});
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
    });

    it('meters the AI query (increments ai_queries) on a successful test run', async () => {
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/general/test').send({});
        expect(res.status).toBe(200);
        expect(aiQueriesCount()).toBe(1);
    });

    it('records monthly spend + a PII-safe cost audit after the test run', async () => {
        await request(makeApp())
            .post('/api/ai/prompt-studio/presets/general/test').send({});
        const cents = testDb.prepare('SELECT cents + micro_cents / 10000 AS cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents;
        expect(cents).toBe(4); // 0.04 USD
        const audit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.prompt_test' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(audit).toBeTruthy();
        expect(JSON.parse(audit.details)).toMatchObject({ feature: 'prompt_test', inputTokens: 90, outputTokens: 30 });
    });

    it('returns 429 QUOTA_EXCEEDED when the monthly AI query cap is reached (provider not called)', async () => {
        seedAiQueries(10000); // Pro cap
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/general/test').send({});
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('QUOTA_EXCEEDED');
        expect(createProviderForUserMock).not.toHaveBeenCalled();
    });

    it('returns 429 AI_SPEND_CAP_REACHED when over the monthly spend cap (provider not called)', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, monthKey(), 150);
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets/general/test').send({});
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(createProviderForUserMock).not.toHaveBeenCalled();
    });
});

// --- Slice 5 — org-shared presets ----------------------------------------

describe('GET /presets — org-shared rows', () => {
    it('includes org rows the user is a member of, not those they are not', async () => {
        // Author is OTHER_USER_ID. The session user is USER_ID and is only
        // a member of `acme`, not `globex`.
        savePreset(OTHER_USER_ID, {
            scope: 'org', scopeTarget: 'acme', presetKey: 'shared-1',
            name: 'Acme shared', systemPrompt: 'shared', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        savePreset(OTHER_USER_ID, {
            scope: 'org', scopeTarget: 'globex', presetKey: 'shared-2',
            name: 'Globex hidden', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        orgMembershipMocks.getCurrentUserOrgs.mockResolvedValue(['acme']);
        orgMembershipMocks.filterOrgsByMembership.mockResolvedValue(['acme']);

        const res = await request(makeApp()).get('/api/ai/prompt-studio/presets');
        expect(res.status).toBe(200);
        const sharedRows = res.body.presets.filter((p) => p.scope === 'org');
        expect(sharedRows).toHaveLength(1);
        expect(sharedRows[0].name).toBe('Acme shared');
        expect(sharedRows[0].scopeTarget).toBe('acme');
        expect(sharedRows[0].shared).toBe(true);
        expect(sharedRows[0].ownedByUser).toBe(false);
    });

    it('marks ownedByUser=true on org rows authored by the caller', async () => {
        savePreset(USER_ID, {
            scope: 'org', scopeTarget: 'acme', presetKey: 'mine-shared',
            name: 'My shared', systemPrompt: 's', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        orgMembershipMocks.getCurrentUserOrgs.mockResolvedValue(['acme']);
        orgMembershipMocks.filterOrgsByMembership.mockResolvedValue(['acme']);

        const res = await request(makeApp()).get('/api/ai/prompt-studio/presets');
        // The row should appear exactly once — once in the user's `custom`
        // list (because listPresets returns user-owned rows of any scope) and
        // de-duplicated out of the org-shared list.
        const matches = res.body.presets.filter((p) => p.name === 'My shared');
        expect(matches).toHaveLength(1);
    });

    it('does not crash when org-membership lookup throws', async () => {
        orgMembershipMocks.getCurrentUserOrgs.mockRejectedValue(new Error('boom'));
        const res = await request(makeApp()).get('/api/ai/prompt-studio/presets');
        expect(res.status).toBe(200);
        // Built-ins still surface even if org enrichment failed.
        expect(res.body.presets.filter((p) => p.builtin)).toHaveLength(5);
    });
});

describe('GET /presets/:id — org-shared rows', () => {
    it('an org member CAN read a non-author org preset', async () => {
        const id = savePreset(OTHER_USER_ID, {
            scope: 'org', scopeTarget: 'acme', presetKey: 'shared',
            name: 'Acme shared', systemPrompt: 'their body', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        orgMembershipMocks.isOrgMember.mockResolvedValue(true);

        const res = await request(makeApp()).get(`/api/ai/prompt-studio/presets/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Acme shared');
        expect(res.body.body).toBe('their body');
        expect(res.body.shared).toBe(true);
        expect(res.body.ownedByUser).toBe(false);
    });

    it('a non-member gets 404 (no leakage)', async () => {
        const id = savePreset(OTHER_USER_ID, {
            scope: 'org', scopeTarget: 'acme', presetKey: 'shared',
            name: 'Acme shared', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        orgMembershipMocks.isOrgMember.mockResolvedValue(false);

        const res = await request(makeApp()).get(`/api/ai/prompt-studio/presets/${id}`);
        expect(res.status).toBe(404);
    });
});

describe('POST /presets — scope=org membership gate', () => {
    const orgBody = {
        scope: 'org',
        scopeTarget: 'acme',
        presetKey: 'team-style',
        name: 'Team style',
        systemPrompt: 'Be consistent',
        pathRules: [],
        severityFloor: null,
    };

    it('Pro user who IS a member → 201', async () => {
        orgMembershipMocks.isOrgMember.mockResolvedValue(true);
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets').send(orgBody);
        expect(res.status).toBe(201);
        expect(res.body.id).toBeGreaterThan(0);
        expect(orgMembershipMocks.isOrgMember).toHaveBeenCalledWith(
            expect.objectContaining({ org: 'acme' }),
        );
    });

    it('Pro user who IS NOT a member → 403 NOT_ORG_MEMBER', async () => {
        orgMembershipMocks.isOrgMember.mockResolvedValue(false);
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets').send(orgBody);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('NOT_ORG_MEMBER');
    });

    it('rejects scope=org without a scopeTarget at validation → 400', async () => {
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets').send({ ...orgBody, scopeTarget: null });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects malformed org login (e.g. "invalid/slashes") at validation → 400', async () => {
        const res = await request(makeApp())
            .post('/api/ai/prompt-studio/presets').send({ ...orgBody, scopeTarget: 'inv/alid' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });
});

describe('PATCH/DELETE /presets/:id — org rows still author-only', () => {
    it('PATCH on another author\'s org row returns 404 even for org members', async () => {
        const id = savePreset(OTHER_USER_ID, {
            scope: 'org', scopeTarget: 'acme', presetKey: 'shared',
            name: 'Theirs', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        // Caller IS a member but is NOT the author → still cannot edit.
        orgMembershipMocks.isOrgMember.mockResolvedValue(true);
        const res = await request(makeApp(USER_ID))
            .patch(`/api/ai/prompt-studio/presets/${id}`).send({ name: 'Hijacked' });
        expect(res.status).toBe(404);
    });

    it('DELETE on another author\'s org row returns 404', async () => {
        const id = savePreset(OTHER_USER_ID, {
            scope: 'org', scopeTarget: 'acme', presetKey: 'shared',
            name: 'Theirs', systemPrompt: 'x', pathRules: [],
            severityFloor: null, isDefault: false,
        });
        orgMembershipMocks.isOrgMember.mockResolvedValue(true);
        const res = await request(makeApp(USER_ID))
            .delete(`/api/ai/prompt-studio/presets/${id}`);
        expect(res.status).toBe(404);
    });
});
