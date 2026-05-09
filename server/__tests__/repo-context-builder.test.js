import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGithubApi = vi.hoisted(() => vi.fn());
vi.mock('../lib/github-api.js', () => ({ githubApi: mockGithubApi }));

const { buildContext } = await import('../lib/repo-context-builder.js');

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

function mockContents(map) {
    // map: path -> content (string) or null for 404
    mockGithubApi.mockImplementation(async (url) => {
        const m = url.match(/\/contents\/([^?]+)/);
        if (!m) throw Object.assign(new Error('unexpected url'), { status: 500 });
        const path = decodeURIComponent(m[1]);
        if (path in map) {
            const content = map[path];
            if (content === null) {
                const err = new Error('Not Found'); err.status = 404; throw err;
            }
            return { data: { encoding: 'base64', content: b64(content) } };
        }
        const err = new Error('Not Found'); err.status = 404; throw err;
    });
}

beforeEach(() => { mockGithubApi.mockReset(); });

describe('buildContext — manifest detection', () => {
    it('detects package.json with first-match priority', async () => {
        mockContents({
            'package.json': '{"name":"x","scripts":{"build":"vite"}}',
            'pyproject.toml': '[project]\nname = "x"',
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { manifest: true, readme: false, topics: false, language: false, entrypoints: false, folderStructure: false },
            customFiles: [],
        });
        const manifest = ctx.sections.find((s) => s.kind === 'manifest');
        expect(manifest).toBeTruthy();
        expect(manifest.label).toBe('package.json');
        expect(manifest.content).toContain('"build":"vite"');
    });

    it('falls through to pyproject.toml when no package.json', async () => {
        mockContents({
            'package.json': null,
            'pyproject.toml': '[project]\nname = "thing"',
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { manifest: true, readme: false, topics: false, language: false, entrypoints: false, folderStructure: false },
            customFiles: [],
        });
        const manifest = ctx.sections.find((s) => s.kind === 'manifest');
        expect(manifest.label).toBe('pyproject.toml');
    });

    it('returns no manifest section when none found', async () => {
        mockContents({}); // every probe 404s
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { manifest: true, readme: false, topics: false, language: false, entrypoints: false, folderStructure: false },
            customFiles: [],
        });
        expect(ctx.sections.find((s) => s.kind === 'manifest')).toBeUndefined();
    });

    it('does NOT fetch manifest when signal is off', async () => {
        mockContents({ 'package.json': '{"name":"x"}' });
        await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { manifest: false, readme: false, topics: false, language: false, entrypoints: false, folderStructure: false },
            customFiles: [],
        });
        // No /contents/ call at all
        expect(mockGithubApi.mock.calls.find((c) => c[0].includes('/contents/'))).toBeUndefined();
    });
});
