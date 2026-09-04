// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock auth middleware so tests don't need a real session
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

// Mock db so route handler can't touch better-sqlite3
vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({
            get: vi.fn(() => null),
            run: vi.fn(() => ({ lastInsertRowid: 1 })),
        })),
        transaction: (fn) => fn,
    },
}));

// Mock import-service so no real git / network happens
vi.mock('../import-service.js', () => ({
    validateSourceUrl: vi.fn(async () => ({ valid: true })),
    sanitizeRepoName: (name) => name || 'imported-repo',
    safeUrl: (u) => u,
    importRepository: vi.fn(() => new Promise(() => { /* never resolves in tests */ })),
}));

// Mock github-api used by /check-duplicates (not under test but imported)
vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }));

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

describe('POST /api/import/url — SSRF guard', () => {
    let app;
    beforeEach(async () => {
        vi.clearAllMocks();
        const { default: urlRouter } = await import('../routes/import/url.js');
        app = makeApp(urlRouter);
    });

    it('rejects http://127.0.0.1/ with 400 and invalid_source_url code', async () => {
        const res = await request(app)
            .post('/api/import/url')
            .send({ sourceUrl: 'http://127.0.0.1/' });
        expect(res.status).toBe(400);
        // Note: validate(importSchema) runs first and would accept it as a
        // well-formed URL; our ssrf guard then rejects the http scheme.
        // Either way we want code: invalid_source_url OR VALIDATION_ERROR
        // but in practice http://127.0.0.1/ passes zod .url() so we hit the guard.
        expect(res.body.code).toBe('invalid_source_url');
    });

    it('rejects https://127.0.0.1/ with invalid_source_url', async () => {
        const res = await request(app)
            .post('/api/import/url')
            .send({ sourceUrl: 'https://127.0.0.1/' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_source_url');
        expect(res.body.error).toMatch(/loopback/);
    });

    it('rejects https://localhost/ with invalid_source_url', async () => {
        const res = await request(app)
            .post('/api/import/url')
            .send({ sourceUrl: 'https://localhost/' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_source_url');
    });

    it('rejects AWS metadata IP', async () => {
        const res = await request(app)
            .post('/api/import/url')
            .send({ sourceUrl: 'https://169.254.169.254/latest/meta-data/' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_source_url');
    });

    it('rejects RFC1918 10/8 addresses', async () => {
        const res = await request(app)
            .post('/api/import/url')
            .send({ sourceUrl: 'https://10.0.0.5/repo.git' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_source_url');
    });

    it('rejects URLs with embedded credentials', async () => {
        const res = await request(app)
            .post('/api/import/url')
            .send({ sourceUrl: 'https://user:pass@evil.com/repo.git' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_source_url');
    });

    it('accepts a public https github URL (returns 201)', async () => {
        const res = await request(app)
            .post('/api/import/url')
            .send({ sourceUrl: 'https://github.com/org/repo.git' });
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
    });

    it('rejects a malformed body (missing sourceUrl) with code "VALIDATION_ERROR"', async () => {
        const res = await request(app)
            .post('/api/import/url')
            .send({ targetOrg: 'myorg' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
    });
});

describe('POST /api/import/validate-url — SSRF guard', () => {
    let app;
    beforeEach(async () => {
        vi.clearAllMocks();
        const { default: urlRouter } = await import('../routes/import/url.js');
        app = makeApp(urlRouter);
    });

    it('rejects file:// schemes', async () => {
        const res = await request(app)
            .post('/api/import/validate-url')
            .send({ url: 'file:///etc/passwd' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_source_url');
    });

    it('rejects 192.168.x.x', async () => {
        const res = await request(app)
            .post('/api/import/validate-url')
            .send({ url: 'https://192.168.1.1/repo' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_source_url');
    });
});
