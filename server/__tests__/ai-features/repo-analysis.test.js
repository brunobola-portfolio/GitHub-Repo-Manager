import { describe, it, expect, vi, afterEach } from 'vitest';
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

    it('surfaces cost/usage as non-enumerable properties for spend-cap accounting', async () => {
        const provider = buildProvider(async () => ({
            text: JSON.stringify({
                summary: 'TL;DR', project_type: 'tool', suggested_topics: [],
                improvements: [], readme_suggestions: [], highlights: [],
            }),
            usage: { inputTokens: 100, outputTokens: 50 },
            costUSD: 0.015,
        }));

        const result = await analyzeRepo({ provider }, repoData, 'readme', []);

        expect(result._costUSD).toBe(0.015);
        expect(result._usage).toEqual({ inputTokens: 100, outputTokens: 50 });
        // Non-enumerable: must not leak into a JSON response or a spread copy.
        expect(Object.keys(result)).not.toContain('_costUSD');
        expect(Object.keys(result)).not.toContain('_usage');
        expect(JSON.stringify(result)).not.toContain('_costUSD');
    });

    it('defaults cost/usage to null when the provider reports none', async () => {
        const provider = buildProvider(async () => ({
            text: JSON.stringify({
                summary: 'TL;DR', project_type: 'tool', suggested_topics: [],
                improvements: [], readme_suggestions: [], highlights: [],
            }),
        }));

        const result = await analyzeRepo({ provider }, repoData, 'readme', []);

        expect(result._costUSD).toBeNull();
        expect(result._usage).toBeNull();
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

    describe('output-token cap enforcement', () => {
        const originalEnv = process.env.AI_MAX_OUTPUT_TOKENS;
        afterEach(() => {
            if (originalEnv === undefined) delete process.env.AI_MAX_OUTPUT_TOKENS;
            else process.env.AI_MAX_OUTPUT_TOKENS = originalEnv;
        });

        it('merges the resolved max-output-tokens cap into generationConfig', async () => {
            process.env.AI_MAX_OUTPUT_TOKENS = '1234';
            let captured;
            const provider = buildProvider(async (args) => {
                captured = args;
                return {
                    text: JSON.stringify({
                        summary: 'x', project_type: 'tool', suggested_topics: [],
                        improvements: [], readme_suggestions: [], highlights: [],
                    }),
                };
            });
            await analyzeRepo({ provider }, repoData, 'readme', []);
            expect(captured.generationConfig).toEqual({ maxOutputTokens: 1234 });
        });

        it('falls back to the default cap when AI_MAX_OUTPUT_TOKENS is unset', async () => {
            delete process.env.AI_MAX_OUTPUT_TOKENS;
            let captured;
            const provider = buildProvider(async (args) => {
                captured = args;
                return {
                    text: JSON.stringify({
                        summary: 'x', project_type: 'tool', suggested_topics: [],
                        improvements: [], readme_suggestions: [], highlights: [],
                    }),
                };
            });
            await analyzeRepo({ provider }, repoData, 'readme', []);
            expect(captured.generationConfig.maxOutputTokens).toBe(2048);
        });
    });
});

describe('ai-features/repo-analysis prompt content', () => {
    it('carries a never-invent guardrail', async () => {
        let captured;
        const provider = buildProvider(async (args) => {
            captured = args.prompt;
            return {
                text: JSON.stringify({
                    summary: 'x', project_type: 'tool', suggested_topics: [],
                    improvements: [], readme_suggestions: [], highlights: [],
                }),
            };
        });
        await analyzeRepo({ provider }, repoData, 'readme', []);
        expect(captured).toMatch(/never invent facts, features, metrics/i);
        expect(captured).toMatch(/very little detectable structure/i);
    });

    it('asks for impact-ranked improvements that cite the motivating signal', async () => {
        let captured;
        const provider = buildProvider(async (args) => {
            captured = args.prompt;
            return {
                text: JSON.stringify({
                    summary: 'x', project_type: 'tool', suggested_topics: [],
                    improvements: [], readme_suggestions: [], highlights: [],
                }),
            };
        });
        await analyzeRepo({ provider }, repoData, 'readme', []);
        expect(captured).toMatch(/ranked by impact\/effort/i);
        expect(captured).toMatch(/must cite the specific signal above/i);
    });
});
