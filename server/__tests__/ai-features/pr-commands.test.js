// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    runPRCommand,
    isSupportedCommand,
    DESCRIBE_SCHEMA,
    TEST_PLAN_SCHEMA,
    IMPROVE_SCHEMA,
    MAX_TEST_CASES,
    MAX_IMPROVEMENTS,
    MAX_DESCRIBE_BODY,
} from '../../lib/ai-features/pr-commands.js';

function buildProvider(generateImpl) {
    return {
        model: {},
        _modelName: 'gemini-test',
        generate: vi.fn(generateImpl),
    };
}

const baseCtx = {
    userId: 1,
    repoFullName: 'acme/api',
    prMetadata: { title: 'Add X', author: 'alice', body: 'desc', additions: 5, deletions: 0 },
    fileManifest: [{ filename: 'src/a.js', status: 'modified', additions: 5, deletions: 0, changes: 5 }],
    diffPatch: '@@ -1,1 +1,1 @@\n-a\n+b\n',
};

describe('isSupportedCommand', () => {
    it('accepts the three supported commands', () => {
        expect(isSupportedCommand('describe')).toBe(true);
        expect(isSupportedCommand('test_plan')).toBe(true);
        expect(isSupportedCommand('improve')).toBe(true);
    });
    it('rejects unknown / non-string commands', () => {
        expect(isSupportedCommand('foo')).toBe(false);
        expect(isSupportedCommand('')).toBe(false);
        expect(isSupportedCommand(null)).toBe(false);
        expect(isSupportedCommand(undefined)).toBe(false);
    });
});

describe('runPRCommand kill switch', () => {
    const original = process.env.DISABLE_AI_REVIEW;
    beforeEach(() => { delete process.env.DISABLE_AI_REVIEW; });
    afterEach(() => {
        if (original === undefined) delete process.env.DISABLE_AI_REVIEW;
        else process.env.DISABLE_AI_REVIEW = original;
    });

    it('returns null when DISABLE_AI_REVIEW=true', async () => {
        process.env.DISABLE_AI_REVIEW = 'true';
        const provider = buildProvider(async () => { throw new Error('should not be called'); });
        const result = await runPRCommand({ provider, ...baseCtx, command: 'describe' });
        expect(result).toBeNull();
        expect(provider.generate).not.toHaveBeenCalled();
    });
});

describe('runPRCommand validation', () => {
    it('throws when provider is missing', async () => {
        await expect(
            runPRCommand({ provider: null, ...baseCtx, command: 'describe' })
        ).rejects.toThrow(/provider/i);
    });

    it('throws on unknown command', async () => {
        const provider = buildProvider(async () => ({ parsed: {} }));
        await expect(
            runPRCommand({ provider, ...baseCtx, command: 'lol_no' })
        ).rejects.toThrow(/Unknown PR command/i);
    });
});

describe('runPRCommand /describe', () => {
    it('returns parsed describe payload with caps applied', async () => {
        const longBody = 'x'.repeat(MAX_DESCRIBE_BODY + 500);
        const provider = buildProvider(async (args) => {
            expect(args.schema).toBe(DESCRIBE_SCHEMA);
            expect(args.generationConfig.responseMimeType).toBe('application/json');
            return { parsed: { title: 'Improved title', body: longBody } };
        });
        const result = await runPRCommand({ provider, ...baseCtx, command: 'describe' });
        expect(result.command).toBe('describe');
        expect(result.output.title).toBe('Improved title');
        // Body capped to MAX_DESCRIBE_BODY (with truncation marker)
        expect(result.output.body.length).toBeLessThanOrEqual(MAX_DESCRIBE_BODY);
        expect(result.output.body).toMatch(/truncated/);
    });

    it('threads usage + costUsd from provider onto the result', async () => {
        const provider = buildProvider(async () => ({
            parsed: { body: 'short' },
            usage: { inputTokens: 100, outputTokens: 50 },
            costUSD: 0.001,
        }));
        const result = await runPRCommand({ provider, ...baseCtx, command: 'describe' });
        expect(result.costUsd).toBe(0.001);
        expect(result.inputTokens).toBe(100);
        expect(result.outputTokens).toBe(50);
        expect(result.modelUsed).toBe('gemini-test');
    });
});

describe('runPRCommand /test_plan', () => {
    it('caps cases at MAX_TEST_CASES and normalises shape', async () => {
        const provider = buildProvider(async (args) => {
            expect(args.schema).toBe(TEST_PLAN_SCHEMA);
            return {
                parsed: {
                    summary: 'plan',
                    cases: Array.from({ length: MAX_TEST_CASES + 5 }, (_, i) => ({
                        name: `case ${i}`,
                        type: i % 2 === 0 ? 'unit' : 'integration',
                        steps: ['Given', 'When', 'Then'],
                        priority: 'high',
                    })),
                },
            };
        });
        const result = await runPRCommand({ provider, ...baseCtx, command: 'test_plan' });
        expect(result.output.cases).toHaveLength(MAX_TEST_CASES);
        expect(result.output.summary).toBe('plan');
    });

    it('coerces unknown type/priority to safe defaults', async () => {
        const provider = buildProvider(async () => ({
            parsed: {
                summary: 's',
                cases: [{ name: 'x', type: 'wat', steps: ['s1'], priority: 'epic' }],
            },
        }));
        const result = await runPRCommand({ provider, ...baseCtx, command: 'test_plan' });
        expect(result.output.cases[0].type).toBe('unit');
        expect(result.output.cases[0].priority).toBe('medium');
    });
});

describe('runPRCommand /improve', () => {
    it('caps suggestions at MAX_IMPROVEMENTS', async () => {
        const provider = buildProvider(async (args) => {
            expect(args.schema).toBe(IMPROVE_SCHEMA);
            return {
                parsed: {
                    summary: 'sum',
                    suggestions: Array.from({ length: MAX_IMPROVEMENTS + 3 }, (_, i) => ({
                        path: `src/file${i}.js`,
                        line: i + 1,
                        severity: 'suggestion',
                        body: `b${i}`,
                    })),
                },
            };
        });
        const result = await runPRCommand({ provider, ...baseCtx, command: 'improve' });
        expect(result.output.suggestions).toHaveLength(MAX_IMPROVEMENTS);
    });

    it('drops suggestion strings with 7+ consecutive backticks (fence escape defence)', async () => {
        const provider = buildProvider(async () => ({
            parsed: {
                summary: 's',
                suggestions: [
                    { path: 'a.js', line: 1, severity: 'warning', body: 'b', suggestion: '```````evil' },
                ],
            },
        }));
        const result = await runPRCommand({ provider, ...baseCtx, command: 'improve' });
        expect(result.output.suggestions[0].suggestion).toBeUndefined();
    });

    it('coerces unknown severity to "suggestion"', async () => {
        const provider = buildProvider(async () => ({
            parsed: {
                summary: 's',
                suggestions: [{ path: 'a.js', severity: 'critical', body: 'b' }],
            },
        }));
        const result = await runPRCommand({ provider, ...baseCtx, command: 'improve' });
        expect(result.output.suggestions[0].severity).toBe('suggestion');
    });
});
