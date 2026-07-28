import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGithubApi = vi.hoisted(() => vi.fn());
const mockProviderGenerate = vi.hoisted(() => vi.fn());
const mockCheckUsageLimit = vi.hoisted(() => vi.fn());
const mockIncrementUsage = vi.hoisted(() => vi.fn());
const mockAuditLog = vi.hoisted(() => vi.fn());
const mockDbGet = vi.hoisted(() => vi.fn());

vi.mock('../lib/github-api.js', () => ({ githubApi: mockGithubApi }));
vi.mock('../lib/usage-meter.js', () => ({
    // Added with reserveAIQuota: a FULL module mock silently drops new
    // exports, and route handlers then call undefined and 500.
    guardedIncrementAIUsage: vi.fn(() => ({ allowed: true, metric: 'ai', current: 0, limit: 100, remaining: 100 })),
    releaseGuardedAIUsage: vi.fn(),
 checkUsageLimit: mockCheckUsageLimit, incrementUsage: mockIncrementUsage }));
vi.mock('../lib/audit.js', () => ({ auditLog: mockAuditLog }));
vi.mock('../db.js', () => ({ default: { prepare: () => ({ get: mockDbGet }) } }));

const provideAIProviderInTest = vi.hoisted(() => ({ enabled: false }));
vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: 1, accessToken: 'fake' };
            req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
            if (provideAIProviderInTest.enabled) req.aiProvider = { generate: mockProviderGenerate };
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

const REPO = { id: 42, name: 'demo', owner: { login: 'o' }, language: 'TS', topics: ['cli'], description: '' };

beforeEach(() => {
    mockGithubApi.mockReset();
    mockProviderGenerate.mockReset();
    mockCheckUsageLimit.mockReset().mockReturnValue({ allowed: true, limit: 100, current: 0 });
    mockIncrementUsage.mockReset();
    mockAuditLog.mockReset();
    mockDbGet.mockReset().mockReturnValue(null);
    provideAIProviderInTest.enabled = false;
});

describe('POST /ai/suggest-name-description with context', () => {
    it('accepts the new context body shape and returns enriched response', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            if (url.endsWith('/readme')) return { data: { encoding: 'base64', content: Buffer.from('# Demo\nA tool.', 'utf8').toString('base64') } };
            if (url.includes('/contents/package.json')) return { data: { encoding: 'base64', content: Buffer.from('{"name":"demo"}', 'utf8').toString('base64') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42, context: { signals: { readme: true, manifest: true, topics: true, language: true } } });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            source: expect.any(String),
            confidence: expect.stringMatching(/^(high|medium|low)$/),
            signalsUsed: expect.any(Array),
            redactions: expect.any(Array),
        });
        expect(res.body.signalsUsed.find((s) => s.kind === 'readme')).toBeTruthy();
        expect(res.body.signalsUsed.find((s) => s.kind === 'manifest')).toBeTruthy();
    });

    it('defaults context.signals when omitted (backwards-compatible body)', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            if (url.endsWith('/readme')) return { data: { encoding: 'base64', content: Buffer.from('# Demo', 'utf8').toString('base64') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.confidence).toBeDefined();
    });

    it('rejects more than 5 customFiles', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({
                repoId: 42,
                context: { customFiles: ['a', 'b', 'c', 'd', 'e', 'f'] },
            });

        expect(res.status).toBe(400);
    });

    it('returns 400 when custom files exceed byte cap', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            if (url.includes('/contents/big.txt')) return { data: { encoding: 'base64', content: Buffer.from('X'.repeat(20_000), 'utf8').toString('base64') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({
                repoId: 42,
                // Disable every other signal so only customFiles compete for budget,
                // and ask for a single large file under a small cap.
                context: { signals: { readme: false, manifest: false, topics: false, language: false }, customFiles: ['big.txt'] },
            });

        // The route must surface the builder's "exceed" error as 400, not 500.
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/budget|exceed/i);
    });

    it('forwards skippedCustomFiles in response', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            if (url.includes('/contents/present.md')) return { data: { encoding: 'base64', content: Buffer.from('hi', 'utf8').toString('base64') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({
                repoId: 42,
                context: { signals: { readme: false, manifest: false, topics: false, language: false }, customFiles: ['present.md', 'missing.md'] },
            });

        expect(res.status).toBe(200);
        expect(res.body.skippedCustomFiles).toEqual(['missing.md']);
    });
});
