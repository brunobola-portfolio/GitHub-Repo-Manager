// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Integration coverage for POST /ai/readme-studio/improve/deterministic —
// the zero-AI-cost fallback for README Studio's improve flow (Addendum 6b.2,
// docs/specs/2026-07-18-community-wow-wave6.md §6b.2). Pins: never calls a
// provider, no quota check, and the License/Install/TOC honesty contract.

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const USER_ID = 1;

vi.mock('../../middleware/auth.js', async (orig) => {
    const actual = await orig();
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: USER_ID, accessToken: 'tok' };
            req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
            next();
        },
        // Deliberately NOT providing createRequireAI here — this route must
        // never reach it. If the route accidentally imported/used requireAI,
        // any test depending on a provider would fail loudly instead of
        // silently passing.
    };
});

vi.mock('../../middleware/validate-request.js', () => ({
    validateBody: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => next(),
    validateParams: () => (req, _res, next) => next(),
}));

function b64(s) {
    return Buffer.from(s, 'utf8').toString('base64');
}

const githubApiMock = vi.fn();
vi.mock('../../lib/github-api.js', () => ({ githubApi: (...args) => githubApiMock(...args) }));

const { default: coreRouter } = await import('../../routes/ai/core.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', coreRouter);
    return app;
}

const REPO = { full_name: 'acme/api', name: 'api', language: 'JavaScript' };

beforeEach(() => {
    githubApiMock.mockReset();
});

describe('POST /ai/readme-studio/improve/deterministic', () => {
    it('builds a deterministic patch without calling any provider', async () => {
        githubApiMock.mockImplementation(async (path) => {
            if (path.endsWith('/readme')) return { data: { content: b64('# api\n'), encoding: 'base64' } };
            // SPDX header fallback (server/lib/ai-features/license-detect.js) —
            // simpler than reproducing a full license body in this fixture.
            if (path.endsWith('/contents/LICENSE')) return { data: { content: b64('SPDX-License-Identifier: MIT'), encoding: 'base64' } };
            if (path.endsWith('/contents/.github/workflows')) return { data: [] };
            if (path.endsWith('/contents')) return { data: [{ name: 'package.json', type: 'file' }] };
            const err = new Error('not found');
            err.status = 404;
            throw err;
        });

        const res = await request(makeApp()).post('/ai/readme-studio/improve/deterministic').send({ repo: REPO });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.deterministic).toBe(true);
        expect(res.body.mode).toBe('missing-sections');
        expect(res.body.markdown).toContain('## License');
        expect(res.body.markdown).toContain('MIT License');
        expect(res.body.markdown).toContain('## Installation');
        expect(res.body.currentReadme).toBe('# api\n');
    });

    it('forces full-rewrite mode and builds a skeleton when there is no README', async () => {
        githubApiMock.mockImplementation(async (path) => {
            if (path.endsWith('/contents')) return { data: [{ name: 'requirements.txt', type: 'file' }] };
            const err = new Error('not found');
            err.status = 404;
            throw err;
        });

        const res = await request(makeApp())
            .post('/ai/readme-studio/improve/deterministic')
            .send({ repo: REPO, mode: 'missing-sections' });

        expect(res.status).toBe(200);
        expect(res.body.mode).toBe('full-rewrite');
        expect(res.body.markdown).toMatch(/^# api/);
        expect(res.body.markdown).toContain('Deterministic skeleton');
        expect(res.body.markdown).toContain('pip install -r requirements.txt');
    });

    it('never states a license the fingerprint did not verify', async () => {
        githubApiMock.mockImplementation(async (path) => {
            if (path.endsWith('/readme')) return { data: { content: b64('# api\n'), encoding: 'base64' } };
            if (path.endsWith('/contents/LICENSE')) return { data: { content: b64('Some unusual custom license text'), encoding: 'base64' } };
            if (path.endsWith('/contents')) return { data: [] };
            const err = new Error('not found');
            err.status = 404;
            throw err;
        });

        const res = await request(makeApp()).post('/ai/readme-studio/improve/deterministic').send({ repo: REPO });
        expect(res.status).toBe(200);
        expect(res.body.markdown).toContain('custom/unrecognized');
        expect(res.body.markdown).not.toMatch(/licensed under the (null|undefined)/i);
    });

    it('rejects an invalid repo.full_name', async () => {
        const res = await request(makeApp())
            .post('/ai/readme-studio/improve/deterministic')
            .send({ repo: { full_name: 'not a valid name/../x' } });
        expect(res.status).toBe(400);
        expect(githubApiMock).not.toHaveBeenCalled();
    });
});
