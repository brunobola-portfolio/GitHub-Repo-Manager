import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGithubApi = vi.hoisted(() => vi.fn());
vi.mock('../lib/github-api.js', () => ({ githubApi: mockGithubApi }));

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => {
        req.session = { userId: 1, accessToken: 'fake' };
        req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        next();
    },
}));

const { default: router } = await import('../routes/repos/tree.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use(router);
    return app;
}

beforeEach(() => { mockGithubApi.mockReset(); });

describe('GET /api/repos/:owner/:name/tree', () => {
    it('returns blob entries with path/type/size', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url.includes('/branches/main')) return { data: { commit: { sha: 'abc' } } };
            if (url.includes('/git/trees/abc')) return { data: { truncated: false, tree: [
                { path: 'README.md', type: 'blob', size: 100 },
                { path: 'src',       type: 'tree' },
                { path: 'src/index.js', type: 'blob', size: 200 },
            ] } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp()).get('/api/repos/o/r/tree?branch=main');
        expect(res.status).toBe(200);
        expect(res.body.entries).toEqual([
            { path: 'README.md', type: 'blob', size: 100 },
            { path: 'src/index.js', type: 'blob', size: 200 },
        ]);
        expect(res.body.truncated).toBe(false);
    });

    it('caps to 500 entries and reports truncated', async () => {
        const tree = Array.from({ length: 600 }, (_, i) => ({ path: `f${i}.js`, type: 'blob', size: 1 }));
        mockGithubApi.mockImplementation(async (url) => {
            if (url.includes('/branches/main')) return { data: { commit: { sha: 'sha' } } };
            if (url.includes('/git/trees/sha')) return { data: { truncated: false, tree } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const res = await request(makeApp()).get('/api/repos/o/r/tree?branch=main');
        expect(res.body.entries).toHaveLength(500);
        expect(res.body.truncated).toBe(true);
    });

    it('reports truncated when GitHub itself truncated the tree', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url.includes('/branches/main')) return { data: { commit: { sha: 'sha' } } };
            if (url.includes('/git/trees/sha')) return { data: { truncated: true, tree: [{ path: 'f.js', type: 'blob', size: 1 }] } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const res = await request(makeApp()).get('/api/repos/o/r/tree?branch=main');
        expect(res.body.truncated).toBe(true);
    });

    it('returns 404 when branch not found', async () => {
        mockGithubApi.mockImplementation(async (_url) => {
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const res = await request(makeApp()).get('/api/repos/o/r/tree?branch=missing');
        expect(res.status).toBe(404);
    });

    it('uses default branch when none provided', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url.match(/\/repos\/o\/r$/)) return { data: { default_branch: 'develop' } };
            if (url.includes('/branches/develop')) return { data: { commit: { sha: 's' } } };
            if (url.includes('/git/trees/s')) return { data: { truncated: false, tree: [] } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const res = await request(makeApp()).get('/api/repos/o/r/tree');
        expect(res.status).toBe(200);
    });
});
