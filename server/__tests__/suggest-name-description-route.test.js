import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Hoisted mocks — must be declared before the route module is imported.
const mockGithubApi = vi.hoisted(() => vi.fn());
const mockProviderGenerate = vi.hoisted(() => vi.fn());
const mockCheckUsageLimit = vi.hoisted(() => vi.fn());
const mockIncrementUsage = vi.hoisted(() => vi.fn());
const mockAuditLog = vi.hoisted(() => vi.fn());

vi.mock('../lib/github-api.js', () => ({
    githubApi: mockGithubApi,
}));
vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: mockCheckUsageLimit,
    incrementUsage: mockIncrementUsage,
}));
vi.mock('../lib/audit.js', () => ({
    auditLog: mockAuditLog,
}));
vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: 1, accessToken: 'fake' };
            req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
            next();
        },
    };
});
vi.mock('../routes/ai/shared.js', () => ({
    requireAI: (req, _res, next) => { req.aiProvider = { generate: mockProviderGenerate }; next(); },
    handleAIError: (res) => res.status(500).json({ error: 'ai-error' }),
}));

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
    mockCheckUsageLimit.mockReturnValue({ allowed: true, current: 0, limit: 100 });
    // First call: GET repo by id; second: GET README contents
    mockGithubApi.mockImplementation((path) => {
        if (path === '/repositories/42') return { data: REPO_PAYLOAD };
        if (path.includes('/contents/README')) {
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
        expect(res.body.proposed.description).toMatch(/Apos.*Point of sale/i);
    });

    it('falls back to deterministic when AI throws', async () => {
        mockProviderGenerate.mockRejectedValue(new Error('boom'));

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('deterministic');
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
});
