import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDeepReview, DEEP_REVIEW_SCHEMA } from '../../lib/ai-features/pr-deep-review.js';

function buildProvider(generateImpl) {
    return {
        model: {},
        generate: vi.fn(generateImpl),
    };
}

const sampleParsed = {
    walkthrough: {
        summary: 'Adds X.',
        perFileTable: [{ path: 'src/a.js', change: 'modified', summary: 'tweak' }],
        mermaid: '',
        estimatedReviewTime: '5 min',
        riskLevel: 'low',
    },
    lineComments: [
        { path: 'src/a.js', side: 'RIGHT', line: 12, startLine: null, severity: 'warning', body: 'use ===', suggestion: 'a === b' },
    ],
};

const baseCtx = {
    userId: 1,
    repoFullName: 'acme/api',
    prMetadata: { title: 'Add X', author: 'alice', body: '', additions: 5, deletions: 0 },
    fileManifest: [{ filename: 'src/a.js', status: 'modified', additions: 5, deletions: 0, changes: 5 }],
    diffPatch: '@@ -10,1 +10,1 @@\n-a == b\n+a === b\n',
};

describe('runDeepReview', () => {
    const originalEnv = process.env.DISABLE_AI_REVIEW;
    beforeEach(() => { delete process.env.DISABLE_AI_REVIEW; });
    afterEach(() => {
        if (originalEnv === undefined) delete process.env.DISABLE_AI_REVIEW;
        else process.env.DISABLE_AI_REVIEW = originalEnv;
    });

    it('returns a parsed DeepReview from the provider (happy path)', async () => {
        const provider = buildProvider(async (args) => {
            expect(args.schema).toBe(DEEP_REVIEW_SCHEMA);
            expect(args.generationConfig.responseMimeType).toBe('application/json');
            expect(Array.isArray(args.parts)).toBe(true);
            return { parsed: sampleParsed };
        });
        const result = await runDeepReview({ provider, ...baseCtx });
        expect(result.walkthrough.summary).toBe('Adds X.');
        expect(result.lineComments).toHaveLength(1);
        expect(result.modelUsed).toBeDefined();
        // Provider returned no usage/costUSD — engine should surface nulls
        // rather than crashing or substituting a 0 (which would imply free).
        expect(result.costUsd).toBeNull();
        expect(result.inputTokens).toBeNull();
        expect(result.outputTokens).toBeNull();
    });

    it('threads usage + costUsd from provider onto the result', async () => {
        const provider = buildProvider(async () => ({
            parsed: sampleParsed,
            usage: { inputTokens: 1000, outputTokens: 500 },
            costUSD: 0.0125,
        }));
        const result = await runDeepReview({ provider, ...baseCtx });
        expect(result.costUsd).toBe(0.0125);
        expect(result.inputTokens).toBe(1000);
        expect(result.outputTokens).toBe(500);
    });

    it('caps lineComments at 25 and folds overflow into the walkthrough', async () => {
        const overflowed = {
            walkthrough: { ...sampleParsed.walkthrough, summary: 'Adds X.' },
            lineComments: Array.from({ length: 40 }, (_, i) => ({
                path: 'src/a.js', side: 'RIGHT', line: i + 1, startLine: null,
                severity: 'info', body: `c${i}`,
            })),
        };
        const provider = buildProvider(async () => ({ parsed: overflowed }));
        const result = await runDeepReview({ provider, ...baseCtx });
        expect(result.lineComments).toHaveLength(25);
        expect(result.walkthrough.summary).toMatch(/15 additional/);
    });

    it('rejects suggestions with 7+ consecutive backticks (fence escape defence)', async () => {
        const malicious = {
            walkthrough: sampleParsed.walkthrough,
            lineComments: [
                { path: 'x', side: 'RIGHT', line: 1, startLine: null, severity: 'info', body: 'b', suggestion: '```````evil' },
            ],
        };
        const provider = buildProvider(async () => ({ parsed: malicious }));
        const result = await runDeepReview({ provider, ...baseCtx });
        expect(result.lineComments[0].suggestion).toBeUndefined();
    });

    it('returns null when DISABLE_AI_REVIEW=true', async () => {
        process.env.DISABLE_AI_REVIEW = 'true';
        const provider = buildProvider(async () => { throw new Error('should not be called'); });
        const result = await runDeepReview({ provider, ...baseCtx });
        expect(result).toBeNull();
        expect(provider.generate).not.toHaveBeenCalled();
    });

    it('throws when provider is missing', async () => {
        await expect(
            runDeepReview({ provider: null, ...baseCtx })
        ).rejects.toThrow(/provider/i);
    });
});
