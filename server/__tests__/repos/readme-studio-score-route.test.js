// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Route-level coverage for GET /:owner/:repo/readme-studio/score — pins the
// "free, deterministic, zero-AI-cost" contract: no requireAI, no quota check,
// just requireAuth + the tolerant-404 signal fetch feeding generateQualityReport.

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../middleware/auth.js', async (orig) => {
    const actual = await orig();
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: 1, accessToken: 'tok' };
            req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
            next();
        },
    };
});

function b64(s) {
    return Buffer.from(s, 'utf8').toString('base64');
}

const githubApiMock = vi.fn();
vi.mock('../../lib/github-api.js', () => ({ githubApi: (...args) => githubApiMock(...args) }));

const { default: readmeStudioRouter } = await import('../../routes/repos/readme-studio.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', readmeStudioRouter);
    return app;
}

beforeEach(() => {
    githubApiMock.mockReset();
});

describe('GET /:owner/:repo/readme-studio/score', () => {
    it('returns a deterministic score report from README + LICENSE + workflow signals', async () => {
        githubApiMock.mockImplementation(async (path) => {
            if (path === '/repos/acme/lib') return { data: { name: 'lib', description: 'A lib', topics: ['x'] } };
            if (path.endsWith('/readme')) return { data: { content: b64('## Installation\nnpm install\n## Usage\nx\n'), encoding: 'base64' } };
            if (path.endsWith('/contents')) return { data: [{ name: 'package.json', type: 'file' }] };
            if (path.endsWith('/contents/LICENSE')) return { data: { content: b64('MIT License'), encoding: 'base64' } };
            if (path.endsWith('/contents/.github/workflows')) return { data: [] };
            throw new Error(`unexpected path ${path}`);
        });

        const res = await request(makeApp()).get('/acme/lib/readme-studio/score');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.repo).toBe('acme/lib');
        expect(res.body.hasReadme).toBe(true);
        expect(res.body.hasLicense).toBe(true);
        expect(typeof res.body.report.score).toBe('number');
        expect(Array.isArray(res.body.report.recommendations)).toBe(true);
    });

    it('degrades gracefully with no README and no LICENSE (never 500s on a missing file)', async () => {
        const err404 = Object.assign(new Error('not found'), { status: 404 });
        githubApiMock.mockImplementation(async (path) => {
            if (path === '/repos/acme/empty') return { data: { name: 'empty', description: null, topics: [] } };
            throw err404;
        });

        const res = await request(makeApp()).get('/acme/empty/readme-studio/score');
        expect(res.status).toBe(200);
        expect(res.body.hasReadme).toBe(false);
        expect(res.body.hasLicense).toBe(false);
        expect(res.body.report.recommendations.some(r => /LICENSE/i.test(r.action))).toBe(true);
    });

    it('never requires an AI provider or checks a quota — pure success path', async () => {
        githubApiMock.mockImplementation(async (path) => {
            if (path === '/repos/acme/lib') return { data: { name: 'lib', description: 'x', topics: [] } };
            const err404 = Object.assign(new Error('not found'), { status: 404 });
            throw err404;
        });
        const res = await request(makeApp()).get('/acme/lib/readme-studio/score');
        expect(res.status).toBe(200);
        // No spend/quota fields anywhere in the response — this is a free endpoint.
        expect(res.body).not.toHaveProperty('code', 'QUOTA_EXCEEDED');
    });

    it('rejects an invalid owner param with 400 INVALID_PARAM', async () => {
        const res = await request(makeApp()).get('/!!bad!!/lib/readme-studio/score');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_PARAM');
    });

    it('returns 500 with a safe message when the base repo fetch fails', async () => {
        githubApiMock.mockRejectedValue(new Error('GitHub is down'));
        const res = await request(makeApp()).get('/acme/lib/readme-studio/score');
        expect(res.status).toBe(500);
        expect(res.body.error).toBeTruthy();
    });
});
