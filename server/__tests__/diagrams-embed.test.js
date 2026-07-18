// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
//
// Coverage for the embed-into-repo routes added to server/routes/ai/diagrams.js
// (Addendum 6b.1): POST /ai/generate-diagram/deterministic, /embed-preview,
// /embed-commit. None of these call an AI provider — only requireAuth is
// exercised, mirroring the other commit-only routes in this codebase.

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const USER_ID = 1;

vi.mock('../middleware/auth.js', async (orig) => {
    const actual = await orig();
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: USER_ID, accessToken: 'tok' };
            req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
            next();
        },
    };
});

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }));

function b64(s) {
    return Buffer.from(s, 'utf8').toString('base64');
}

const README_CONTENT = '# acme/api\n\nAn intro paragraph.\n\n## Installation\n\nnpm install';

// Mutable per-test state so each test can control what the fake GitHub API
// returns without redefining the whole mock module.
let readmeState = { exists: true, content: README_CONTENT, path: 'README.md' };
let permissionsState = { push: true };
let putCalls = [];
let branchProtected = false;

vi.mock('../lib/github-api.js', () => ({
    githubApi: vi.fn(async (path, _token, opts) => {
        if (/\/repos\/[^/]+\/[^/]+$/.test(path) && (!opts || opts.method === undefined)) {
            return { data: { default_branch: 'main', permissions: { push: permissionsState.push } } };
        }
        if (path.endsWith('/readme')) {
            if (!readmeState.exists) {
                const err = new Error('not found');
                err.status = 404;
                throw err;
            }
            return { data: { content: b64(readmeState.content), encoding: 'base64', path: readmeState.path } };
        }
        if (path.includes('/branches/') && path.endsWith('/protection')) {
            if (branchProtected) return { data: {} };
            const err = new Error('not found');
            err.status = 404;
            throw err;
        }
        if (opts?.method === 'PUT' && path.includes('/contents/')) {
            putCalls.push({ path, body: JSON.parse(opts.body) });
            return { data: { content: { sha: 'newsha' } } };
        }
        if (path.includes('/contents')) {
            return { data: [{ name: 'src', type: 'dir' }] };
        }
        if (path.includes('/git/refs/heads/')) {
            return { data: { object: { sha: 'basesha' } } };
        }
        if (opts?.method === 'POST' && path.includes('/git/refs')) {
            return { data: {} };
        }
        if (opts?.method === 'POST' && path.includes('/pulls')) {
            return { data: { html_url: 'https://github.com/acme/api/pull/1' } };
        }
        const err = new Error('not found');
        err.status = 404;
        throw err;
    }),
}));

const { default: diagramsRouter } = await import('../routes/ai/diagrams.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/', diagramsRouter);
    return app;
}

const REPO = { full_name: 'acme/api', name: 'api', language: 'JavaScript' };
const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

beforeEach(() => {
    readmeState = { exists: true, content: README_CONTENT, path: 'README.md' };
    permissionsState = { push: true };
    putCalls = [];
    branchProtected = false;
});

describe('POST /ai/generate-diagram/deterministic', () => {
    it('returns a deterministic flowchart without calling any provider', async () => {
        const res = await request(makeApp()).post('/ai/generate-diagram/deterministic').send({ repo: REPO });
        expect(res.status).toBe(200);
        expect(res.body.deterministic).toBe(true);
        expect(res.body.mermaid).toContain('flowchart TD');
        expect(res.body.mermaid).toMatch(/Structure diagram \(deterministic/);
    });

    it('rejects an invalid repo.full_name', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/deterministic')
            .send({ repo: { full_name: 'not a valid/../name' } });
        expect(res.status).toBe(400);
    });
});

describe('POST /ai/generate-diagram/embed-preview — readme-mermaid target', () => {
    it('inserts a marker-wrapped mermaid block after the intro and returns the exact diff', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'readme-mermaid', mermaid: 'graph TD\n  A --> B' });

        expect(res.status).toBe(200);
        expect(res.body.hasReadme).toBe(true);
        expect(res.body.readOnly).toBe(false);
        expect(res.body.action).toBe('inserted');
        expect(res.body.readme.after).toContain('repo-manager:diagram:architecture:start');
        expect(res.body.readme.after).toContain('```mermaid\ngraph TD\n  A --> B\n```');
        expect(res.body.readme.before).toBe(README_CONTENT);
    });

    it('replaces an existing marker block on regeneration instead of duplicating it', async () => {
        readmeState.content = `${README_CONTENT}\n\n<!-- repo-manager:diagram:architecture:start -->\n\`\`\`mermaid\nold\n\`\`\`\n<!-- repo-manager:diagram:architecture:end -->`;
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'readme-mermaid', mermaid: 'graph TD\n  new' });

        expect(res.body.action).toBe('replaced');
        expect(res.body.readme.after).not.toContain('old');
        expect((res.body.readme.after.match(/repo-manager:diagram:architecture:start/g) || []).length).toBe(1);
    });

    it('surfaces a notice for malformed (half) markers and appends fresh instead of failing', async () => {
        readmeState.content = `${README_CONTENT}\n\n<!-- repo-manager:diagram:architecture:start -->\nstray`;
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'readme-mermaid', mermaid: 'graph TD\n  new' });

        expect(res.body.action).toBe('appended-malformed');
        expect(res.body.notice).toMatch(/malformed/i);
    });

    it('honors an explicit placement option', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'readme-mermaid', mermaid: 'graph TD\n  A', placement: 'top' });

        expect(res.body.readme.after.indexOf('repo-manager:diagram')).toBeLessThan(res.body.readme.after.indexOf('# acme/api'));
    });

    it('the no-README path offers create-README-or-SVG-only instead of failing', async () => {
        readmeState.exists = false;
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'readme-mermaid', mermaid: 'graph TD\n  A' });

        expect(res.status).toBe(200);
        expect(res.body.hasReadme).toBe(false);
        expect(res.body.notice).toMatch(/no readme found/i);
        expect(res.body.readme).toBeUndefined();
    });

    it('surfaces an honest read-only state when the user lacks push rights', async () => {
        permissionsState.push = false;
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'readme-mermaid', mermaid: 'graph TD\n  A' });

        expect(res.status).toBe(200);
        expect(res.body.readOnly).toBe(true);
    });

    it('labels the preview when the diagram was generated from a truncated tree', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'readme-mermaid', mermaid: 'graph TD\n  A', truncated: true });

        expect(res.body.readme.after).toMatch(/partial \(truncated\) file tree/);
    });
});

describe('POST /ai/generate-diagram/embed-preview — svg-file target', () => {
    it('sanitizes the SVG and returns both the SVG commit payload and the README image-ref diff', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'svg-file', svg: CLEAN_SVG });

        expect(res.status).toBe(200);
        expect(res.body.svg.path).toBe('docs/diagrams/architecture.svg');
        expect(res.body.svg.content).toContain('<svg');
        expect(res.body.readme.after).toContain('![Architecture diagram](docs/diagrams/architecture.svg)');
    });

    it('rejects an SVG that fails sanitization/validation', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'svg-file', svg: '<div>not svg</div>' });

        expect(res.status).toBe(422);
        expect(res.body.code).toBe('invalid_svg');
    });

    it('embeds SVG-only (no README section) when there is no README', async () => {
        readmeState.exists = false;
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-preview')
            .send({ repo: REPO, target: 'svg-file', svg: CLEAN_SVG });

        expect(res.status).toBe(200);
        expect(res.body.hasReadme).toBe(false);
        expect(res.body.readme).toBeNull();
        expect(res.body.svg.path).toBe('docs/diagrams/architecture.svg');
        expect(res.body.notice).toMatch(/no readme found/i);
    });
});

describe('POST /ai/generate-diagram/embed-commit', () => {
    it('commits the README (readme-mermaid target) via commitOrOpenPR and reports the outcome', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-commit')
            .send({
                repo: REPO, target: 'readme-mermaid', mode: 'direct',
                readme: { path: 'README.md', content: README_CONTENT + '\nnew', commitMessage: 'docs: embed diagram' },
            });

        expect(res.status).toBe(200);
        expect(res.body.readme.mode).toBe('direct');
        expect(putCalls.some((c) => c.path.includes('README.md'))).toBe(true);
    });

    it('commits both the SVG and the README (svg-file target) as two sequential commits', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-commit')
            .send({
                repo: REPO, target: 'svg-file', mode: 'direct',
                svg: { path: 'docs/diagrams/architecture.svg', content: CLEAN_SVG, commitMessage: 'docs: add diagram svg' },
                readme: { path: 'README.md', content: README_CONTENT + '\n![diagram](docs/diagrams/architecture.svg)', commitMessage: 'docs: reference diagram svg' },
            });

        expect(res.status).toBe(200);
        expect(res.body.svg.mode).toBe('direct');
        expect(res.body.readme.mode).toBe('direct');
        expect(putCalls.some((c) => c.path.includes('docs/diagrams/architecture.svg'))).toBe(true);
        expect(putCalls.some((c) => c.path.includes('README.md'))).toBe(true);
    });

    it('commits SVG-only when no readme payload is provided', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-commit')
            .send({
                repo: REPO, target: 'svg-file', mode: 'direct',
                svg: { path: 'docs/diagrams/architecture.svg', content: CLEAN_SVG, commitMessage: 'docs: add diagram svg' },
            });

        expect(res.status).toBe(200);
        expect(res.body.svg).toBeTruthy();
        expect(res.body.readme).toBeUndefined();
    });

    it('re-validates the SVG at commit time and rejects a tampered payload even past preview', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-commit')
            .send({
                repo: REPO, target: 'svg-file', mode: 'direct',
                svg: { path: 'docs/diagrams/architecture.svg', content: '<div>not svg</div>', commitMessage: 'docs: add diagram svg' },
            });

        expect(res.status).toBe(422);
        expect(res.body.code).toBe('invalid_svg');
        expect(putCalls.length).toBe(0);
    });

    it('falls back to a PR when the default branch is protected, and reports pr-fallback', async () => {
        branchProtected = true;
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-commit')
            .send({
                repo: REPO, target: 'readme-mermaid', mode: 'direct',
                readme: { path: 'README.md', content: README_CONTENT + '\nnew', commitMessage: 'docs: embed diagram' },
            });

        expect(res.status).toBe(200);
        expect(res.body.readme.mode).toBe('pr-fallback');
        expect(res.body.readme.prUrl).toBeTruthy();
    });

    it('refuses to commit for a user without push access (no PR-from-fork in v1)', async () => {
        permissionsState.push = false;
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-commit')
            .send({
                repo: REPO, target: 'readme-mermaid', mode: 'direct',
                readme: { path: 'README.md', content: README_CONTENT + '\nnew', commitMessage: 'docs: embed diagram' },
            });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('read_only_access');
        expect(putCalls.length).toBe(0);
    });

    it('rejects a readme-mermaid target request missing the readme payload', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-commit')
            .send({ repo: REPO, target: 'readme-mermaid', mode: 'direct' });
        expect(res.status).toBe(400);
    });
})

describe('embed-commit path hardening', () => {
    it('rejects an svg.path that does not match the diagram type', async () => {
        const res = await request(makeApp())
            .post('/ai/generate-diagram/embed-commit')
            .send({
                repo: { full_name: 'acme/app' },
                diagramType: 'architecture',
                target: 'svg-file',
                svg: { path: 'docs/evil/../../secrets.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', commitMessage: 'x' },
            })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('validation_failed')
    })

    it('rejects a readme.path that is not a README file or traverses', async () => {
        for (const path of ['src/index.js', 'docs/../../README.md', '/README.md']) {
            const res = await request(makeApp())
                .post('/ai/generate-diagram/embed-commit')
                .send({
                    repo: { full_name: 'acme/app' },
                    diagramType: 'architecture',
                    target: 'readme-mermaid',
                    readme: { path, content: '# x', commitMessage: 'x' },
                })
            expect(res.status).toBe(400)
            expect(res.body.code).toBe('validation_failed')
        }
    })
})
