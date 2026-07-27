// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Coverage for POST /ai/generate-diagram (server/routes/ai/diagrams.js):
// grounded prompt building (pure, no provider mock needed), fence-stripping,
// the check-once/increment-once quota design for the retry-once self-repair
// flow, spend-cap gating, and audit metadata.

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
        text: '```mermaid\ngraph TD\n  A[src] --> B[server]\n```',
        usage: { inputTokens: 300, outputTokens: 60 },
        costUSD: 0.04,
    })),
};

vi.mock('../middleware/auth.js', async (orig) => {
    const actual = await orig();
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: USER_ID, accessToken: 'tok' };
            req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
            next();
        },
        createRequireAI: () => (req, _res, next) => { req.aiProvider = fakeProvider; next(); },
    };
});

// validate-request.js is NOT mocked — the real zod middleware runs, so the
// full_name regex and the retry→failedSource refine are exercised for real.

function b64(s) {
    return Buffer.from(s, 'utf8').toString('base64');
}

vi.mock('../lib/github-api.js', () => ({
    githubApi: vi.fn(async (path) => {
        if (path.endsWith('/readme')) {
            return { data: { content: b64('# lib\n'), encoding: 'base64' } };
        }
        if (path.endsWith('/contents')) {
            return { data: [{ name: 'src', type: 'dir' }, { name: 'package.json', type: 'file' }] };
        }
        if (/\/repos\/[^/]+\/[^/]+$/.test(path)) {
            return { data: { default_branch: 'main' } };
        }
        if (path.includes('/branches/')) {
            return { data: { commit: { sha: 'deadbeef' } } };
        }
        if (path.includes('/git/trees/')) {
            return {
                data: {
                    truncated: false,
                    tree: [
                        { path: 'src/index.js', type: 'blob' },
                        { path: 'server/index.js', type: 'blob' },
                    ],
                },
            };
        }
        const err = new Error('not found');
        err.status = 404;
        throw err;
    }),
}));

const { default: diagramsRouter, buildDiagramPrompt, cleanMermaidText } = await import('../routes/ai/diagrams.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', diagramsRouter);
    return app;
}

const REPO = { full_name: 'acme/api', name: 'api', language: 'JavaScript' };

beforeEach(() => {
    testDb.prepare('DELETE FROM ai_spend').run();
    testDb.prepare('DELETE FROM usage_metrics').run();
    testDb.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
    fakeProvider.generate.mockClear();
    delete process.env.AI_SPEND_CAP_CENTS;
});

describe('buildDiagramPrompt (pure)', () => {
    it('grounds the prompt in the provided top-level contents and tree, never inventing structure', () => {
        const prompt = buildDiagramPrompt({
            repo: { full_name: 'acme/api', language: 'JavaScript' },
            diagramType: 'architecture',
            topLevel: [{ name: 'src', type: 'dir' }],
            treeEntries: [{ path: 'src/index.js' }, { path: 'server/index.js' }],
            truncated: false,
            readmeSnippet: '# api\n',
        });
        expect(prompt).toContain('acme/api');
        expect(prompt).toContain('src/index.js');
        expect(prompt).toContain('never invent');
        expect(prompt).toContain('not a verified static-analysis dependency graph');
    });

    it('adds a truncation note when the tree was capped', () => {
        const prompt = buildDiagramPrompt({
            repo: { full_name: 'acme/big' }, diagramType: 'architecture',
            topLevel: [], treeEntries: [{ path: 'a' }], truncated: true, readmeSnippet: '',
        });
        expect(prompt).toMatch(/truncated/i);
    });

    it('adds a sparse-repo honesty note when almost nothing was detected', () => {
        const prompt = buildDiagramPrompt({
            repo: { full_name: 'acme/empty' }, diagramType: 'architecture',
            topLevel: [], treeEntries: [], truncated: false, readmeSnippet: '',
        });
        expect(prompt).toMatch(/very little detectable file structure/i);
    });

    it('includes a few-shot Mermaid syntax example, clearly marked as format reference not content', () => {
        const prompt = buildDiagramPrompt({
            repo: { full_name: 'acme/api', language: 'JavaScript' },
            diagramType: 'architecture',
            topLevel: [{ name: 'src', type: 'dir' }],
            treeEntries: [{ path: 'src/index.js' }, { path: 'server/index.js' }],
            truncated: false,
            readmeSnippet: '# api\n',
        });
        expect(prompt).toContain('flowchart TD');
        expect(prompt).toMatch(/format reference/i);
        expect(prompt).toMatch(/not this repository's actual structure/i);
    });

    it('appends the failed source + parser error on retry', () => {
        const prompt = buildDiagramPrompt({
            repo: { full_name: 'acme/api' }, diagramType: 'architecture',
            topLevel: [], treeEntries: [{ path: 'a' }], truncated: false, readmeSnippet: '',
            retry: true, failedSource: 'graph TD\n  A --> ', parseError: 'Unexpected end of input',
        });
        expect(prompt).toContain('failed to parse');
        expect(prompt).toContain('Unexpected end of input');
        expect(prompt).toContain('A -->');
    });
});

describe('cleanMermaidText (pure)', () => {
    it('strips a ```mermaid fence', () => {
        expect(cleanMermaidText('```mermaid\ngraph TD\n  A --> B\n```')).toBe('graph TD\n  A --> B');
    });

    it('strips a bare ``` fence', () => {
        expect(cleanMermaidText('```\ngraph TD\n  A --> B\n```')).toBe('graph TD\n  A --> B');
    });

    it('passes through unfenced raw mermaid unchanged (modulo trim)', () => {
        expect(cleanMermaidText('  graph TD\n  A --> B  ')).toBe('graph TD\n  A --> B');
    });

    it('returns an empty string for non-string input', () => {
        expect(cleanMermaidText(undefined)).toBe('');
        expect(cleanMermaidText(null)).toBe('');
    });
});

describe('POST /ai/generate-diagram', () => {
    it('generates a grounded diagram and strips the fence from the response', async () => {
        const res = await request(makeApp()).post('/ai/generate-diagram').send({ repo: REPO });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.mermaid).toBe('graph TD\n  A[src] --> B[server]');
        expect(res.body.diagramType).toBe('architecture');
        expect(res.body.truncated).toBe(false);
        expect(fakeProvider.generate).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid repo.full_name', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram')
            .send({ repo: { full_name: 'not a valid name/../x' } });
        expect(res.status).toBe(400);
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });

    it('rejects retry:true without a failedSource', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram')
            .send({ repo: REPO, retry: true });
        expect(res.status).toBe(400);
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });

    it('records monthly spend + a PII-safe cost + usage audit tagged generate_diagram', async () => {
        await request(makeApp()).post('/ai/generate-diagram').send({ repo: REPO });

        const cents = testDb.prepare('SELECT cents + micro_cents / 10000 AS cents FROM ai_spend WHERE user_id = ?').get(USER_ID)?.cents;
        expect(cents).toBe(4); // 0.04 USD

        const costAudit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.diagram' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(costAudit).toBeTruthy();
        expect(JSON.parse(costAudit.details)).toMatchObject({ feature: 'diagram' });

        const usageAudit = testDb.prepare(
            "SELECT details FROM audit_log_v2 WHERE user_id = ? AND action = 'ai.generate_diagram' ORDER BY id DESC LIMIT 1"
        ).get(USER_ID);
        expect(usageAudit).toBeTruthy();
        expect(JSON.parse(usageAudit.details)).toMatchObject({ repo: 'acme/api', diagramType: 'architecture', retry: false });
    });

    it('increments the ai_diagram quota on the initial (non-retry) request', async () => {
        await request(makeApp()).post('/ai/generate-diagram').send({ repo: REPO });
        const count = testDb.prepare(
            "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_diagram'"
        ).get(USER_ID)?.count;
        expect(count).toBe(1);
    });

    it('does NOT double-decrement the ai_diagram quota on a retry-once self-repair call', async () => {
        await request(makeApp()).post('/ai/generate-diagram').send({ repo: REPO });
        const res = await request(makeApp())
            .post('/ai/generate-diagram')
            .send({ repo: REPO, retry: true, failedSource: 'graph TD\n  A -->', parseError: 'bad syntax' });

        expect(res.status).toBe(200);
        expect(fakeProvider.generate).toHaveBeenCalledTimes(2);
        const count = testDb.prepare(
            "SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = 'ai_diagram'"
        ).get(USER_ID)?.count;
        expect(count).toBe(1); // still 1 — the retry did not decrement quota again
    });

    it('returns 429 with the diagram quota when the free-tier cap is already hit', async () => {
        const month = new Date().toISOString().slice(0, 7) + '-01T00:00:00.000Z';
        testDb.prepare(`
            INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end)
            VALUES (?, 'ai_diagram', 15, ?, ?)
        `).run(USER_ID, month, month);

        const res = await request(makeApp()).post('/ai/generate-diagram').send({ repo: REPO });
        expect(res.status).toBe(429);
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });

    it('a retry-once call still succeeds past the feature cap (only the spend cap gates it)', async () => {
        const month = new Date().toISOString().slice(0, 7) + '-01T00:00:00.000Z';
        testDb.prepare(`
            INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end)
            VALUES (?, 'ai_diagram', 15, ?, ?)
        `).run(USER_ID, month, month);

        const res = await request(makeApp())
            .post('/ai/generate-diagram')
            .send({ repo: REPO, retry: true, failedSource: 'graph TD\n  A -->', parseError: 'bad syntax' });
        expect(res.status).toBe(200);
        expect(fakeProvider.generate).toHaveBeenCalledTimes(1);
    });

    it('returns 429 AI_SPEND_CAP_REACHED when over the monthly spend cap (provider not called)', async () => {
        process.env.AI_SPEND_CAP_CENTS = '100';
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare('INSERT INTO ai_spend (user_id, month, cents) VALUES (?, ?, ?)').run(USER_ID, month, 150);

        const res = await request(makeApp()).post('/ai/generate-diagram').send({ repo: REPO });
        expect(res.status).toBe(429);
        expect(res.body.code).toBe('AI_SPEND_CAP_REACHED');
        expect(fakeProvider.generate).not.toHaveBeenCalled();
    });
});
