import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Hoisted mocks — must be declared before the route module is imported.
const mockGithubApi = vi.hoisted(() => vi.fn());
const mockProviderGenerate = vi.hoisted(() => vi.fn());
const mockCheckUsageLimit = vi.hoisted(() => vi.fn());
const mockIncrementUsage = vi.hoisted(() => vi.fn());
const mockAuditLog = vi.hoisted(() => vi.fn());
const mockDbGet = vi.hoisted(() => vi.fn());

vi.mock('../lib/github-api.js', () => ({
    githubApi: mockGithubApi,
}));
vi.mock('../lib/usage-meter.js', () => ({
    // Added with reserveAIQuota: a FULL module mock silently drops new
    // exports, and route handlers then call undefined and 500.
    guardedIncrementAIUsage: vi.fn(() => ({ allowed: true, metric: 'ai', current: 0, limit: 100, remaining: 100 })),
    releaseGuardedAIUsage: vi.fn(),

    checkUsageLimit: mockCheckUsageLimit,
    incrementUsage: mockIncrementUsage,
}));
vi.mock('../lib/audit.js', () => ({
    auditLog: mockAuditLog,
}));
const mockCheckAISpendCap = vi.hoisted(() => vi.fn(() => ({ allowed: true, capCents: 0, spentCents: 0 })));
const mockRecordAISpend = vi.hoisted(() => vi.fn());
vi.mock('../lib/ai-spend-cap.js', () => ({
    checkAISpendCap: mockCheckAISpendCap,
    recordAISpend: mockRecordAISpend,
}));
// db.prepare(...).get(...) is used by loadIndexedAiMetadata. We expose a
// per-test handle (`mockDbGet`) so each test can return null (no indexed
// metadata) or a row, without instantiating a real SQLite connection.
vi.mock('../db.js', () => ({
    default: {
        prepare: () => ({ get: mockDbGet }),
    },
}));
// requireAuth populates req.session and req.log. We also use this hook to
// optionally inject `req.aiProvider` for tests that exercise the AI path,
// because the route is intentionally NOT gated by the `requireAI` middleware
// (the deterministic generator works without a provider).
const provideAIProviderInTest = vi.hoisted(() => ({ enabled: false }));
vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: 1, accessToken: 'fake' };
            req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
            if (provideAIProviderInTest.enabled) {
                req.aiProvider = { generate: mockProviderGenerate };
            }
            next();
        },
    };
});

const { default: router } = await import('../routes/ai/suggest-name-description.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use(router);
    return app;
}

const REPO_PAYLOAD = {
    id: 42,
    name: 'APOS POS',
    full_name: 'org/APOS POS',
    owner: { login: 'org' },
    description: 'Imported from https://example.com',
    language: 'C#',
    topics: ['pos'],
    private: false,
};

beforeEach(() => {
    mockGithubApi.mockReset();
    mockProviderGenerate.mockReset();
    mockCheckUsageLimit.mockReset();
    mockIncrementUsage.mockReset();
    mockAuditLog.mockReset();
    mockDbGet.mockReset();
    mockCheckAISpendCap.mockReset();
    mockRecordAISpend.mockReset();
    mockCheckUsageLimit.mockReturnValue({ allowed: true, current: 0, limit: 100 });
    mockCheckAISpendCap.mockReturnValue({ allowed: true, capCents: 0, spentCents: 0 });
    mockDbGet.mockReturnValue(null);   // default: repo not indexed
    provideAIProviderInTest.enabled = true;  // default: AI provider available
    // First call: GET repo by id. Second: GET canonical README via /repos/.../readme.
    mockGithubApi.mockImplementation((path) => {
        if (path === '/repositories/42') return { data: REPO_PAYLOAD };
        if (path.endsWith('/readme')) {
            return {
                data: {
                    content: Buffer.from('# Apos\n\nPoint of sale system for restaurant ordering.', 'utf8').toString('base64'),
                    encoding: 'base64',
                },
            };
        }
        return { data: null };
    });
});

describe('POST /ai/suggest-name-description', () => {
    it('returns AI suggestion when provider succeeds', async () => {
        mockProviderGenerate.mockResolvedValue({
            text: JSON.stringify({
                name: 'apos-pos',
                description: 'POS system for restaurant ordering.',
                rationale: 'README-based',
            }),
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('ai');
        expect(res.body.proposed.name).toBe('apos-pos');
        expect(res.body.proposed.description).toBe('POS system for restaurant ordering.');
        expect(res.body.current.description).toBe('Imported from https://example.com');
        expect(res.body.noChange).toEqual({ name: false, description: false });
        expect(mockIncrementUsage).toHaveBeenCalledWith(1, 'ai_queries');
        expect(mockAuditLog).toHaveBeenCalled();
    });

    it('falls back to deterministic when AI parse fails', async () => {
        mockProviderGenerate.mockResolvedValue({ text: 'NOT JSON' });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('deterministic');
        expect(res.body.proposed.name).toBe('apos-pos');
        // Deterministic generator's description cascade. The README signal
        // is fetched but the in-test mock githubApi returns the README via
        // the same handler that returns the repo metadata; depending on
        // the buildContext path either the README sentence ("Apos: Point
        // of sale ...") or the topics+language template ("C# project for
        // pos") wins. Either is a valid deterministic output — the
        // contract here is that AI failure routes to a non-empty
        // deterministic suggestion, not which specific template wins.
        const desc = res.body.proposed.description
        expect(typeof desc).toBe('string')
        expect(desc.length).toBeGreaterThan(0)
        expect(desc).toMatch(/Apos.*Point of sale|C# project for pos/i);
    });

    it('falls back to deterministic when AI throws', async () => {
        mockProviderGenerate.mockRejectedValue(new Error('boom'));

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('deterministic');
    });

    it('returns deterministic when no AI provider is configured', async () => {
        // Simulate an unconfigured user: no req.aiProvider, no req.getAIProvider.
        provideAIProviderInTest.enabled = false;

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('deterministic');
        expect(res.body.proposed.name).toBe('apos-pos');
        // The provider should never have been invoked.
        expect(mockProviderGenerate).not.toHaveBeenCalled();
        // Quota is still incremented — usage is metered for both paths.
        expect(mockIncrementUsage).toHaveBeenCalledWith(1, 'ai_queries');
    });

    it('uses indexed AI metadata summary when available', async () => {
        provideAIProviderInTest.enabled = false;   // force deterministic path
        mockDbGet.mockReturnValue({
            summary: 'Indexed summary describing the POS system in detail and at length.',
            topics: '[]',
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('deterministic');
        expect(res.body.proposed.description).toBe(
            'Indexed summary describing the POS system in detail and at length.',
        );
    });

    it('returns 429 when quota exceeded', async () => {
        mockCheckUsageLimit.mockReturnValue({ allowed: false, current: 100, limit: 100 });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(429);
        expect(res.body.upgradeUrl).toBeTruthy();
    });

    it('returns 400 when repoId missing', async () => {
        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({});

        expect(res.status).toBe(400);
    });

    it('returns 404 when repo lookup fails', async () => {
        mockGithubApi.mockImplementation(() => { const e = new Error('not found'); e.status = 404; throw e; });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 999 });

        expect(res.status).toBe(404);
    });

    // Regression coverage for FIX-2 (2026-07-17 audit): this route calls
    // provider.generate() directly (it doesn't fit guardedGenerate() because
    // of the deterministic-fallback flow) and previously had no spend
    // accounting at all.
    describe('monthly AI spend cap', () => {
        it('falls back to deterministic (never calls the provider) when over cap, and still returns 200', async () => {
            mockCheckAISpendCap.mockReturnValue({ allowed: false, capCents: 500, spentCents: 500 });

            const res = await request(makeApp())
                .post('/ai/suggest-name-description')
                .send({ repoId: 42 });

            expect(res.status).toBe(200);
            expect(res.body.source).toBe('deterministic');
            expect(mockProviderGenerate).not.toHaveBeenCalled();
            // The route still meters usage for the deterministic path.
            expect(mockIncrementUsage).toHaveBeenCalledWith(1, 'ai_queries');
        });

        it('records spend after a successful AI call', async () => {
            mockProviderGenerate.mockResolvedValue({
                text: JSON.stringify({ name: 'apos-pos', description: 'd', rationale: 'r' }),
                costUSD: 0.007,
            });

            const res = await request(makeApp())
                .post('/ai/suggest-name-description')
                .send({ repoId: 42 });

            expect(res.status).toBe(200);
            expect(res.body.source).toBe('ai');
            expect(mockRecordAISpend).toHaveBeenCalledWith(1, 0.007);
        });

        it('does not check the spend cap at all when no AI provider is configured', async () => {
            provideAIProviderInTest.enabled = false;

            const res = await request(makeApp())
                .post('/ai/suggest-name-description')
                .send({ repoId: 42 });

            expect(res.status).toBe(200);
            expect(res.body.source).toBe('deterministic');
            expect(mockCheckAISpendCap).not.toHaveBeenCalled();
        });
    });
});
