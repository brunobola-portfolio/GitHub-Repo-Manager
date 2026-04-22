import { describe, it, expect, vi } from 'vitest';
import { analyzeRepo } from '../../lib/ai-features/repo-analysis.js';
import { AIError, AI_ERROR_CODE } from '../../lib/ai-provider.js';

function buildProvider(generateImpl) {
    return {
        model: {},
        embeddingModel: {},
        generate: vi.fn(generateImpl),
    };
}

const repoData = {
    name: 'awesome-repo',
    description: 'Does stuff.',
    language: 'JavaScript',
    topics: ['cli'],
    stargazers_count: 10,
    forks_count: 2,
    open_issues_count: 1,
};

describe('ai-features/repo-analysis.analyzeRepo', () => {
    it('merges AI response with computed quality metrics (happy path)', async () => {
        const provider = buildProvider(async () => ({
            text: JSON.stringify({
                summary: 'TL;DR',
                project_type: 'tool',
                suggested_topics: ['a', 'b'],
                improvements: ['x'],
                readme_suggestions: ['Add usage'],
                highlights: ['nice'],
            }),
        }));

        const result = await analyzeRepo(
            { provider },
            repoData,
            '# hello\n## Installation\n',
            [{ name: 'package.json', type: 'file' }],
        );

        expect(provider.generate).toHaveBeenCalledOnce();
        expect(result.summary).toBe('TL;DR');
        expect(result.project_type).toBe('tool');
        // quality fields injected
        expect(typeof result.health_score).toBe('number');
        expect(result.quality_breakdown).toBeDefined();
        expect(result.patterns.hasInstallation).toBe(true);
    });

    it('translates NOT_FOUND AIError into human-friendly message', async () => {
        const provider = buildProvider(async () => {
            throw new AIError({ code: AI_ERROR_CODE.NOT_FOUND, message: 'model not found', status: 404 });
        });

        await expect(
            analyzeRepo({ provider }, repoData, 'readme', []),
        ).rejects.toThrow(/AI model not available/);
    });

    it('throws a clear error when the provider is not initialized', async () => {
        await expect(
            analyzeRepo({ provider: null }, repoData, 'readme', []),
        ).rejects.toThrow(/AI model not initialized/);
    });
});
