import { describe, it, expect, vi } from 'vitest';
import { enhanceReadme } from '../../lib/ai-features/readme-enhance.js';
import { AIError, AI_ERROR_CODE } from '../../lib/ai-provider.js';

function buildProvider(generateImpl) {
    return {
        model: {},
        embeddingModel: {},
        generate: vi.fn(generateImpl),
    };
}

const repoData = { name: 'lib', language: 'JavaScript', description: 'does things' };

describe('ai-features/readme-enhance.enhanceReadme', () => {
    it('returns markdown enhancement + detected missing sections (happy path)', async () => {
        const md = '## Installation\nnpm install\n';
        const provider = buildProvider(async () => ({ text: md }));

        const result = await enhanceReadme({ provider }, '', repoData, []);
        expect(result.enhancement).toBe(md);
        // empty README → installation + usage + examples + contributing + license + API missing
        expect(result.missingSections).toContain('Installation');
        expect(result.missingSections).toContain('Usage');
        expect(result.missingSections).toContain('License');
        expect(result.patterns).toBeDefined();
    });

    it('translates NOT_FOUND AIError into a human-friendly message (error path)', async () => {
        const provider = buildProvider(async () => {
            throw new AIError({ code: AI_ERROR_CODE.NOT_FOUND, message: 'model not found', status: 404 });
        });
        await expect(
            enhanceReadme({ provider }, 'readme', repoData, []),
        ).rejects.toThrow(/AI model not available/);
    });
});
