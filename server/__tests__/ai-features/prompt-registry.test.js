// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- Mocks --------------------------------------------------------------
// Store: drives the explicit-id and default-resolution branches.
const storeMocks = {
    getPresetById: vi.fn(),
    getDefaultForScope: vi.fn(),
    listPresets: vi.fn(() => []),
};
vi.mock('../../lib/ai-prompt-store.js', () => storeMocks);

// readThrough: simulates the gh-cache layer wrapping the GitHub fetch.
const readThroughMock = vi.fn();
vi.mock('../../lib/gh-cache.js', () => ({
    readThrough: (...args) => readThroughMock(...args),
}));

// githubApi: irrelevant in most tests because readThrough is mocked,
// but we stub it so the import resolves cleanly.
vi.mock('../../lib/github-api.js', () => ({
    githubApi: vi.fn(),
}));

// Logger: silence debug noise from the style-guide miss path.
vi.mock('../../lib/logger.js', () => ({
    default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ai-prompt-registry.getResolvedPrompt: return a deterministic base so we
// can assert composition without exercising the real prompt registry.
vi.mock('../../lib/ai-prompt-registry.js', () => ({
    getResolvedPrompt: vi.fn((_userId, _key, vars) =>
        `BASE_PROMPT[repo=${vars.repo_full_name},title=${vars.pr_title},author=${vars.author}]`),
}));

const { resolvePromptForGenerate } = await import('../../lib/ai-features/prompt-registry.js');
const { BUILTIN_PRESETS } = await import('../../lib/ai-features/builtin-prompts.js');

// ---- Fixtures -----------------------------------------------------------
const baseCtx = {
    userId: 1,
    repoOwner: 'acme',
    repoName: 'api',
    prTitle: 'Add feature X',
    author: 'octocat',
    session: { userId: 1, accessToken: 'tkn' },
};

beforeEach(() => {
    storeMocks.getPresetById.mockReset();
    storeMocks.getDefaultForScope.mockReset();
    storeMocks.listPresets.mockReset().mockReturnValue([]);
    readThroughMock.mockReset();
});

describe('resolvePromptForGenerate', () => {
    it('explicit built-in presetKey "security" → preset:security source, OWASP body, warning floor', async () => {
        const out = await resolvePromptForGenerate({ ...baseCtx, presetKey: 'security' });
        expect(out.source).toBe('preset:security');
        expect(out.name).toBe(BUILTIN_PRESETS.security.name);
        expect(out.systemPrompt).toContain('BASE_PROMPT[repo=acme/api');
        expect(out.systemPrompt).toContain('OWASP');
        expect(out.severityFloor).toBe('warning');
        expect(out.pathRules).toEqual([]);
    });

    it('explicit numeric id of an owned preset loads via store with source user:<id>', async () => {
        storeMocks.getPresetById.mockReturnValue({
            id: 42,
            name: 'My Preset',
            systemPrompt: 'CUSTOM_BODY',
            severityFloor: 'critical',
            pathRules: [{ glob: 'src/**', extraPrompt: 'tight' }],
        });
        const out = await resolvePromptForGenerate({ ...baseCtx, presetKey: 42 });
        expect(storeMocks.getPresetById).toHaveBeenCalledWith(1, 42);
        expect(out.source).toBe('user:42');
        expect(out.name).toBe('My Preset');
        expect(out.systemPrompt).toContain('CUSTOM_BODY');
        expect(out.severityFloor).toBe('critical');
        expect(out.pathRules).toEqual([{ glob: 'src/**', extraPrompt: 'tight' }]);
    });

    it('explicit numeric id of an unowned preset throws PRESET_NOT_FOUND', async () => {
        storeMocks.getPresetById.mockReturnValue(null);
        await expect(resolvePromptForGenerate({ ...baseCtx, presetKey: 99 }))
            .rejects.toMatchObject({ code: 'PRESET_NOT_FOUND' });
    });

    it('explicit unknown built-in string throws PRESET_NOT_FOUND', async () => {
        await expect(resolvePromptForGenerate({ ...baseCtx, presetKey: 'made-up-name' }))
            .rejects.toMatchObject({ code: 'PRESET_NOT_FOUND' });
    });

    it('no presetKey + repo default exists → uses repo default', async () => {
        storeMocks.getDefaultForScope.mockImplementation((userId, scope, target) => {
            if (scope === 'repo' && target === 'acme/api') {
                return {
                    id: 7,
                    name: 'Repo Default',
                    systemPrompt: 'REPO_BODY',
                    severityFloor: 'warning',
                    pathRules: [],
                };
            }
            return null;
        });
        const out = await resolvePromptForGenerate(baseCtx);
        expect(out.source).toBe('repo-default:7');
        expect(out.name).toBe('Repo Default');
        expect(out.systemPrompt).toContain('REPO_BODY');
        expect(out.severityFloor).toBe('warning');
    });

    it('no presetKey + no repo default + user default exists → uses user default', async () => {
        storeMocks.getDefaultForScope.mockImplementation((userId, scope, target) => {
            if (scope === 'repo') return null;
            if (scope === 'user' && target === null) {
                return {
                    id: 11,
                    name: 'My User Default',
                    systemPrompt: 'USER_BODY',
                    severityFloor: null,
                    pathRules: [{ glob: '**/*.test.js', extraPrompt: 'tests' }],
                };
            }
            return null;
        });
        const out = await resolvePromptForGenerate(baseCtx);
        expect(out.source).toBe('user-default:11');
        expect(out.name).toBe('My User Default');
        expect(out.systemPrompt).toContain('USER_BODY');
        expect(out.pathRules).toEqual([{ glob: '**/*.test.js', extraPrompt: 'tests' }]);
    });

    it('no presetKey + no defaults → falls back to BUILTIN_PRESETS.general', async () => {
        storeMocks.getDefaultForScope.mockReturnValue(null);
        const out = await resolvePromptForGenerate(baseCtx);
        expect(out.source).toBe('fallback');
        expect(out.name).toBe(BUILTIN_PRESETS.general.name);
        expect(out.systemPrompt).toContain(BUILTIN_PRESETS.general.body.slice(0, 30));
    });

    it('${REPO_STYLE_GUIDE} substituted with fetched file content', async () => {
        const styleGuide = '# Review Rules\n- Always check for secrets';
        const base64 = Buffer.from(styleGuide, 'utf-8').toString('base64');
        readThroughMock.mockResolvedValue({ data: { content: base64, encoding: 'base64' } });

        // Use an owned numeric preset whose body references the token.
        storeMocks.getPresetById.mockReturnValue({
            id: 5,
            name: 'Style-aware',
            systemPrompt: 'Apply repo style guide:\n${REPO_STYLE_GUIDE}\nThanks.',
            severityFloor: null,
            pathRules: [],
        });

        const out = await resolvePromptForGenerate({ ...baseCtx, presetKey: 5 });
        expect(out.systemPrompt).toContain('# Review Rules');
        expect(out.systemPrompt).toContain('Always check for secrets');
        expect(out.systemPrompt).not.toContain('${REPO_STYLE_GUIDE}');
        expect(readThroughMock).toHaveBeenCalledTimes(1);
    });

    it('${REPO_STYLE_GUIDE} substituted with empty string when fetch fails', async () => {
        const err = new Error('Not Found');
        err.status = 404;
        readThroughMock.mockRejectedValue(err);

        storeMocks.getPresetById.mockReturnValue({
            id: 6,
            name: 'Style-aware-2',
            systemPrompt: 'Apply: ${REPO_STYLE_GUIDE} END',
            severityFloor: null,
            pathRules: [],
        });

        const out = await resolvePromptForGenerate({ ...baseCtx, presetKey: 6 });
        expect(out.systemPrompt).not.toContain('${REPO_STYLE_GUIDE}');
        expect(out.systemPrompt).toContain('Apply:  END'); // empty replacement
    });

    it('skips style-guide fetch entirely when no session/access token', async () => {
        storeMocks.getPresetById.mockReturnValue({
            id: 8,
            name: 'No-Session',
            systemPrompt: 'Body: ${REPO_STYLE_GUIDE}',
            severityFloor: null,
            pathRules: [],
        });
        const out = await resolvePromptForGenerate({ ...baseCtx, session: null, presetKey: 8 });
        expect(readThroughMock).not.toHaveBeenCalled();
        expect(out.systemPrompt).toContain('Body: ');
        expect(out.systemPrompt).not.toContain('${REPO_STYLE_GUIDE}');
    });

    it('severityFloor is carried through to the output', async () => {
        const out1 = await resolvePromptForGenerate({ ...baseCtx, presetKey: 'refactor' });
        expect(out1.severityFloor).toBe('info');

        const out2 = await resolvePromptForGenerate({ ...baseCtx, presetKey: 'general' });
        expect(out2.severityFloor).toBeNull();
    });

    it('does not call readThrough when the preset body has no style-guide token', async () => {
        const out = await resolvePromptForGenerate({ ...baseCtx, presetKey: 'security' });
        expect(readThroughMock).not.toHaveBeenCalled();
        expect(out.source).toBe('preset:security');
    });

    it('caps oversized style guide content at 16KB', async () => {
        // Style guide of 20000 chars — should be truncated at 16384.
        const huge = 'x'.repeat(20000);
        const base64 = Buffer.from(huge, 'utf-8').toString('base64');
        readThroughMock.mockResolvedValue({ data: { content: base64, encoding: 'base64' } });

        storeMocks.getPresetById.mockReturnValue({
            id: 9,
            name: 'Big-style',
            systemPrompt: 'Apply: ${REPO_STYLE_GUIDE}',
            severityFloor: null,
            pathRules: [],
        });

        const out = await resolvePromptForGenerate({ ...baseCtx, presetKey: 9 });
        expect(out.systemPrompt).toContain('[truncated');
        expect(out.systemPrompt).not.toContain('${REPO_STYLE_GUIDE}');
        // Bounded: base prompt + divider + preset body + 16KB style guide + truncation marker.
        // The full untrimmed content (20000 chars of 'x') must NOT appear.
        expect(out.systemPrompt).not.toContain('x'.repeat(20000));
        // Sanity: total length < base + ~17KB padding for divider/marker.
        expect(out.systemPrompt.length).toBeLessThan(20000);
    });

    it('strips newlines from preset name in the divider', async () => {
        storeMocks.getPresetById.mockReturnValue({
            id: 10,
            name: 'Line1\nLine2\r\nLine3',
            systemPrompt: 'BODY',
            severityFloor: null,
            pathRules: [],
        });

        const out = await resolvePromptForGenerate({ ...baseCtx, presetKey: 10 });
        // Find the divider line and assert it has no embedded newlines inside the
        // `--- Active preset: ... ---` segment.
        const dividerMatch = out.systemPrompt.match(/--- Active preset: [^\n\r]* ---/);
        expect(dividerMatch).not.toBeNull();
        expect(dividerMatch[0]).toBe('--- Active preset: Line1 Line2 Line3 ---');
        // The original output `name` field is unchanged (carries through verbatim).
        expect(out.name).toBe('Line1\nLine2\r\nLine3');
    });
});
