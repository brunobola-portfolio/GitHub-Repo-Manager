// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = req.session || { userId: 1, accessToken: 'ghp_test' };
            next();
        },
    };
});

vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({
            get: vi.fn(() => null),
            run: vi.fn(() => ({ lastInsertRowid: 1 })),
        })),
        transaction: (fn) => fn,
    },
}));

vi.mock('../import-service.js', () => ({
    validateSourceUrl: vi.fn(async () => ({ valid: true })),
    sanitizeRepoName: (name) => name || 'imported-repo',
    safeUrl: (u) => u,
    importRepository: vi.fn(() => new Promise(() => {})),
}));

const githubApi = vi.fn();
vi.mock('../lib/github-api.js', () => ({ githubApi }));

function makeApp(router) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
        next();
    });
    app.use('/api', router);
    return app;
}

describe('POST /api/import/check-duplicates', () => {
    let app;
    beforeEach(async () => {
        vi.clearAllMocks();
        const { default: urlRouter } = await import('../routes/import/url.js');
        app = makeApp(urlRouter);
    });

    it('treats an existing empty repo as NOT a duplicate (size=0, no default branch)', async () => {
        githubApi.mockResolvedValueOnce({ size: 0, default_branch: null, html_url: 'https://github.com/acme/empty-repo' });
        const res = await request(app)
            .post('/api/import/check-duplicates')
            .send({ targetOwner: 'acme', repos: ['empty-repo'] });
        expect(res.status).toBe(200);
        expect(res.body.duplicates).toEqual({ 'empty-repo': false });
        expect(res.body.duplicateDetails['empty-repo']).toMatchObject({
            exists: true,
            empty: true,
            sizeKb: 0,
            defaultBranch: null,
        });
    });

    it('treats an existing populated repo as a duplicate (size>0 or default branch set)', async () => {
        githubApi.mockResolvedValueOnce({ size: 1024, default_branch: 'main', html_url: 'https://github.com/acme/busy-repo' });
        const res = await request(app)
            .post('/api/import/check-duplicates')
            .send({ targetOwner: 'acme', repos: ['busy-repo'] });
        expect(res.body.duplicates).toEqual({ 'busy-repo': true });
        expect(res.body.duplicateDetails['busy-repo']).toMatchObject({
            exists: true,
            empty: false,
            sizeKb: 1024,
            defaultBranch: 'main',
        });
    });

    it('reports non-existing repos as exists:false', async () => {
        githubApi.mockRejectedValueOnce(new Error('Not Found'));
        const res = await request(app)
            .post('/api/import/check-duplicates')
            .send({ targetOwner: 'acme', repos: ['missing'] });
        expect(res.body.duplicates).toEqual({ missing: false });
        expect(res.body.duplicateDetails.missing).toEqual({ exists: false, empty: false });
    });

    it('handles a batch of mixed states in a single request', async () => {
        githubApi
            .mockResolvedValueOnce({ size: 0, default_branch: null })  // empty
            .mockResolvedValueOnce({ size: 50, default_branch: 'main' })  // populated
            .mockRejectedValueOnce(new Error('Not Found'));  // missing
        const res = await request(app)
            .post('/api/import/check-duplicates')
            .send({ targetOwner: 'acme', repos: ['empty', 'busy', 'gone'] });
        expect(res.body.duplicates).toEqual({ empty: false, busy: true, gone: false });
    });

    it('guards against a stale size=0 read by also requiring no default_branch', async () => {
        // Edge case: an old repo with size=0 in the API response but an
        // actual default_branch set — should still be treated as populated.
        githubApi.mockResolvedValueOnce({ size: 0, default_branch: 'main' });
        const res = await request(app)
            .post('/api/import/check-duplicates')
            .send({ targetOwner: 'acme', repos: ['stale'] });
        expect(res.body.duplicates).toEqual({ stale: true });
        expect(res.body.duplicateDetails.stale.empty).toBe(false);
    });
});
