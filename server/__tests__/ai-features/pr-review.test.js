import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reviewPullRequest, PR_REVIEW_SCHEMA } from '../../lib/ai-features/pr-review.js';

function buildProvider(generateImpl) {
    return {
        model: {},
        embeddingModel: {},
        generate: vi.fn(generateImpl),
    };
}

const prMetadata = {
    title: 'Add feature',
    author: 'alice',
    base: { ref: 'main' },
    head: { ref: 'feature/x' },
    body: 'description',
    additions: 10,
    deletions: 2,
};
const fileManifest = [
    { filename: 'src/a.js', status: 'modified', additions: 5, deletions: 2, changes: 7 },
];

describe('ai-features/pr-review.reviewPullRequest', () => {
    const originalEnv = process.env.DISABLE_AI_REVIEW;

    beforeEach(() => {
        delete process.env.DISABLE_AI_REVIEW;
    });
    afterEach(() => {
        if (originalEnv === undefined) delete process.env.DISABLE_AI_REVIEW;
        else process.env.DISABLE_AI_REVIEW = originalEnv;
    });

    it('returns structured parsed payload from the provider (happy path)', async () => {
        const parsed = {
            overview: 'ok',
            riskLevel: 'low',
            keyChanges: ['x'],
            fileRisks: [{ file: 'src/a.js', risk: 'low', reason: 'trivial' }],
            suggestedReviewOrder: ['src/a.js'],
            estimatedReviewTime: '5 min',
        };
        const provider = buildProvider(async (args) => {
            expect(args.schema).toBe(PR_REVIEW_SCHEMA);
            expect(args.generationConfig.responseMimeType).toBe('application/json');
            expect(Array.isArray(args.parts)).toBe(true);
            expect(args.parts).toHaveLength(2);
            return { parsed };
        });

        const result = await reviewPullRequest({ provider }, fileManifest, 'diff text', prMetadata);
        expect(result).toEqual(parsed);
    });

    it('returns null when DISABLE_AI_REVIEW=true (kill switch)', async () => {
        process.env.DISABLE_AI_REVIEW = 'true';
        const provider = buildProvider(async () => {
            throw new Error('should not be called');
        });
        const result = await reviewPullRequest({ provider }, fileManifest, '', prMetadata);
        expect(result).toBeNull();
        expect(provider.generate).not.toHaveBeenCalled();
    });

    it('throws when provider is not initialized (error path)', async () => {
        await expect(
            reviewPullRequest({ provider: null }, fileManifest, '', prMetadata),
        ).rejects.toThrow(/AI model not initialized/);
    });
});
