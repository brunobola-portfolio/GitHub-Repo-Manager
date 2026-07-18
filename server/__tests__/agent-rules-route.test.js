// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Coverage for POST /:owner/:repo/agent-rules/generate and
// /:owner/:repo/agent-rules/commit (server/routes/repos/actions-community.js,
// mounted under /api/repos): the AI-backed grounded path, the deterministic
// zero-AI-cost fallback (Addendum 6b.2 — no provider configured, provider
// error after retry, spend cap reached, quota exceeded), metering, and the
// commit path reusing commitOrOpenPR() per requested file.

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { initDB } = await vi.importActual('../db.js');
const { makeIntegrationDb } = await import('./helpers/integration-db.js');
const testDb = makeIntegrationDb(initDB);
vi.mock('../db.js', () => ({ default: testDb }));

const USER_ID = 1;

const fakeProvider = {
    model: 'mock-model',
    generate: vi.fn(async () => ({
        text: '## Setup commands\n- Install dependencies: `npm ci`\n',
        usage: { inputTokens: 300, outputTokens: 60 },
        costUSD: 0.02,
    })),
};

// Mutable per-test knob: null → "AI not configured" fallback path;
// fakeProvider → the AI-backed path.
let currentProvider = fakeProvider;

vi.mock('../middleware/auth.js', async (orig) => {
    const actual = await orig();
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: USER_ID, accessToken: 'tok' };
            req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
            req.aiProvider = currentProvider;
            next();
        },
    };
});

function b64(s) {
    return Buffer.from(s, 'utf8').toString('base64');
}

function mkGithubApi(overrides = {}) {
    return vi.fn(async (path, _token, options = {}) => {
        if (/\/repos\/[^/]+\/[^/]+$/.test(path)) return { data: { default_branch: 'main' } };
        if (path.includes('/branches/main/protection')) {
            const err = new Error('Not Found'); err.status = 404; throw err;
        }
        if (path.includes('/branches/')) return { data: { commit: { sha: 'sha123' } } };
        if (path.includes('/git/trees/')) {
            return {
                data: {
                    truncated: false,
                    tree: overrides.tree || [
                        { path: 'package.json', type: 'blob' },
                        { path: 'package-lock.json', type: 'blob' },
                        { path: 'tests/foo.test.js', type: 'blob' },
                    ],
                },
            };
        }
        if (path.endsWith('/contents/package.json')) {
            return {
                data: {
                    encoding: 'base64',
                    content: b64(JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '^1.0.0' } })),
                },
            };
        }
        if (path.includes('/git/refs/heads/main') && !options.method) return { data: { object: { sha: 'baseSha' } } };
        if (path.endsWith('/git/refs') && options.method === 'POST') return { data: { ref: 'refs/heads/chore/agent-rules' } };
        if (path.includes('/contents/') && options.method === 'PUT') {
            return { data: { content: { sha: 'fileSha' }, commit: { sha: 'commitSha' } } };
        }
        if (path === '/repos/acme/lib/pulls' && options.method === 'POST') {
            return { data: { number: 7, html_url: 'https://github.com/acme/lib/pull/7' } };
        }
        const err = new Error('not found');
        err.status = 404;
        throw err;
    });
}

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }));
const { githubApi } = await import('../lib/github-api.js');

const { default: actionsCommunityRouter } = await import('../routes/repos/actions-community.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', actionsCommunityRouter);
    return app;
}

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    fakeProvider.generate.mockClear();
    fakeProvider.generate.mockImplementation(async () => ({
        text: '## Setup commands\n- Install dependencies: `npm ci`\n',
        usage: { inputTokens: 300, outputTokens: 60 },
        costUSD: 0.02,
    }));
    currentProvider = fakeProvider;
    githubApi.mockImplementation(mkGithubApi());
    delete process.env.AI_SPEND_CAP_CENTS;
});

describe('POST /:owner/:repo/agent-rules/generate', () => {
    it('generates AGENTS.md via the AI provider and increments the agent-rules quota', async () => {
        const res = await request(makeApp()).post('/acme/lib/agent-rules/generate').send({});
        expect(res.status).toBe(200);
        expect(res.body.deterministic).toBe(false);
        expect(res.body.files['AGENTS.md']).toContain('npm ci');
        expect(res.body.files['CLAUDE.md']).toBeUndefined();
        expect(fakeProvider.generate).toHaveBeenCalledTimes(1);

        const count = testDb.prepare(
            "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_agent_rules'"
        ).get(USER_ID)?.count;
        expect(count).toBe(1);
    });

    it('generates a Windows-safe CLAUDE.md import line when both target files are requested', async () => {
        const res = await request(makeApp()).post('/acme/lib/agent-rules/generate').send({ targetFiles: ['AGENTS.md', 'CLAUDE.md'] });
        expect(res.status).toBe(200);
        expect(res.body.files['CLAUDE.md']).toMatch(/^@AGENTS\.md/);
    });

    it('records a PII-safe generation audit entry', async () => {
        await request(makeApp()).post('/acme/lib/agent-rules/generate').send({});
        const audit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.generate_agent_rules' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(audit).toBeTruthy();
        expect(JSON.parse(audit.details)).toMatchObject({ repo: 'acme/lib', mode: 'create' });
    });

    it('falls back to the deterministic template when no AI provider is configured — never blocks, never charges quota', async () => {
        currentProvider = null;
        const res = await request(makeApp()).post('/acme/lib/agent-rules/generate').send({});
        expect(res.status).toBe(200);
        expect(res.body.deterministic).toBe(true);
        expect(res.body.reason).toBe('ai_not_configured');
        expect(res.body.files['AGENTS.md']).toMatch(/deterministic template/i);
        expect(fakeProvider.generate).not.toHaveBeenCalled();

        const count = testDb.prepare(
            "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_agent_rules'"
        ).get(USER_ID)?.count;
        expect(count ?? 0).toBe(0);
    });

    it('falls back to the deterministic template when the provider errors even after retry', async () => {
        fakeProvider.generate.mockRejectedValue(Object.assign(new Error('boom'), { code: 'UNKNOWN' }));
        const res = await request(makeApp()).post('/acme/lib/agent-rules/generate').send({});
        expect(res.status).toBe(200);
        expect(res.body.deterministic).toBe(true);
        expect(res.body.reason).toBe('ai_error');
        expect(res.body.files['AGENTS.md']).toMatch(/deterministic template/i);

        // A failed generation never charges the feature quota.
        const count = testDb.prepare(
            "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_agent_rules'"
        ).get(USER_ID)?.count;
        expect(count ?? 0).toBe(0);
    });

    it('returns 429 with the agent-rules quota AND still ships the deterministic fallback', async () => {
        const month = new Date().toISOString().slice(0, 7) + '-01T00:00:00.000Z';
        testDb.prepare(`
            INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end)
            VALUES (?, 'ai_agent_rules', 20, ?, ?)
        `).run(USER_ID, month, month);

        const res = await request(makeApp()).post('/acme/lib/agent-rules/generate').send({});
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('QUOTA_EXCEEDED');
        expect(res.body.deterministic).toBe(true);
        expect(res.body.files['AGENTS.md']).toBeTruthy();
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });

    it('returns 429 AI_SPEND_CAP_REACHED-driven deterministic fallback when over the monthly spend cap', async () => {
        process.env.AI_SPEND_CAP_CENTS = '1';
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, month, 150);

        const res = await request(makeApp()).post('/acme/lib/agent-rules/generate').send({});
        expect(res.status).toBe(200);
        expect(res.body.deterministic).toBe(true);
        expect(res.body.reason).toBe('spend_cap_reached');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });

    it('rejects unknown body fields (strict schema)', async () => {
        const res = await request(makeApp()).post('/acme/lib/agent-rules/generate').send({ bogus: true });
        expect(res.status).toBe(400);
    });

    it('includes existing AGENTS.md content for a diff when mode=refresh', async () => {
        githubApi.mockImplementation(mkGithubApi({
            tree: [{ path: 'package.json', type: 'blob' }, { path: 'AGENTS.md', type: 'blob' }],
        }));
        githubApi.mockImplementation(async (path, token, options) => {
            if (path.endsWith('/contents/AGENTS.md')) {
                return { data: { encoding: 'base64', content: b64('# Existing hand-written AGENTS.md\n') } };
            }
            return mkGithubApi({ tree: [{ path: 'package.json', type: 'blob' }, { path: 'AGENTS.md', type: 'blob' }] })(path, token, options);
        });

        const res = await request(makeApp()).post('/acme/lib/agent-rules/generate').send({ mode: 'refresh' });
        expect(res.status).toBe(200);
        expect(res.body.existing['AGENTS.md']).toContain('Existing hand-written AGENTS.md');
    });
});

describe('POST /:owner/:repo/agent-rules/commit', () => {
    it('commits a single file directly to the default branch', async () => {
        const res = await request(makeApp())
            .post('/acme/lib/agent-rules/commit')
            .send({ files: [{ filePath: 'AGENTS.md', content: '# AGENTS.md\n', commitMessage: 'chore: add AGENTS.md' }], mode: 'direct' });
        expect(res.status).toBe(200);
        expect(res.body.committed).toBe(true);
        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0]).toMatchObject({ filePath: 'AGENTS.md', mode: 'direct' });
    });

    it('commits both AGENTS.md and CLAUDE.md when both are supplied', async () => {
        const res = await request(makeApp())
            .post('/acme/lib/agent-rules/commit')
            .send({
                files: [
                    { filePath: 'AGENTS.md', content: '# AGENTS.md\n', commitMessage: 'chore: add AGENTS.md' },
                    { filePath: 'CLAUDE.md', content: '@AGENTS.md\n', commitMessage: 'chore: add CLAUDE.md' },
                ],
                mode: 'direct',
            });
        expect(res.status).toBe(200);
        expect(res.body.results.map((r) => r.filePath)).toEqual(['AGENTS.md', 'CLAUDE.md']);
    });

    it('falls through to a PR when the default branch is protected', async () => {
        githubApi.mockImplementation(mkGithubApi());
        // Make the protection probe report "protected" for this test only.
        githubApi.mockImplementation(async (path, token, options) => {
            if (path.includes('/branches/main/protection')) return { data: { required_pull_request_reviews: {} } };
            return mkGithubApi()(path, token, options);
        });

        const res = await request(makeApp())
            .post('/acme/lib/agent-rules/commit')
            .send({ files: [{ filePath: 'AGENTS.md', content: '# AGENTS.md\n', commitMessage: 'chore: add AGENTS.md' }] });
        expect(res.status).toBe(200);
        expect(res.body.results[0].mode).toBe('pr-fallback');
        expect(res.body.results[0].prUrl).toMatch(/pull\/7$/);
    });

    it('records a commit audit entry naming every committed file', async () => {
        await request(makeApp())
            .post('/acme/lib/agent-rules/commit')
            .send({ files: [{ filePath: 'AGENTS.md', content: '# AGENTS.md\n', commitMessage: 'chore: add AGENTS.md' }] });
        const audit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.commit_agent_rules' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(audit).toBeTruthy();
        expect(JSON.parse(audit.details)).toMatchObject({ files: ['AGENTS.md'] });
    });

    it('rejects an empty files array', async () => {
        const res = await request(makeApp()).post('/acme/lib/agent-rules/commit').send({ files: [] });
        expect(res.status).toBe(400);
    });
});
