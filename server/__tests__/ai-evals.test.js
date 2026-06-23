// server/__tests__/ai-evals.test.js
//
// Framework tests for server/lib/ai-evals.js
// Covers: all scorers (positive + negative), combinators, mock provider,
// runEval (handler invocation + aggregation), diffAgainstBaseline.

import { describe, it, expect } from 'vitest';
import {
    createMockProvider,
    defineEval,
    runEval,
    diffAgainstBaseline,
    exactMatch,
    jsonShape,
    enumMatch,
    lengthBounds,
    regexMatch,
    numberRange,
    allOf,
    anyOf,
    llmJudge,
} from '../lib/ai-evals.js';

// ---------------------------------------------------------------------------
// createMockProvider
// ---------------------------------------------------------------------------

describe('createMockProvider', () => {
    it('returns the configured response text', async () => {
        const provider = createMockProvider('hello world');
        const result = await provider.generate({ prompt: 'ignored' });
        expect(result.text).toBe('hello world');
    });

    it('parses JSON response into .parsed', async () => {
        const provider = createMockProvider('{"key": 42}');
        const result = await provider.generate();
        expect(result.parsed).toEqual({ key: 42 });
    });

    it('sets .parsed to null for non-JSON response', async () => {
        const provider = createMockProvider('not json');
        const result = await provider.generate();
        expect(result.parsed).toBeNull();
    });

    it('generateStream yields the response', async () => {
        const provider = createMockProvider('streamed text');
        const chunks = [];
        for await (const chunk of provider.generateStream()) {
            chunks.push(chunk);
        }
        expect(chunks).toEqual(['streamed text']);
    });

    it('embed throws with a clear error', async () => {
        const provider = createMockProvider('x');
        await expect(provider.embed('text')).rejects.toThrow('embed not supported in mock eval mode');
    });
});

// ---------------------------------------------------------------------------
// Scorers: exactMatch
// ---------------------------------------------------------------------------

describe('exactMatch', () => {
    it('passes on deep equality (primitives)', () => {
        expect(exactMatch(42, 42).pass).toBe(true);
        expect(exactMatch('hello', 'hello').pass).toBe(true);
    });

    it('passes on deep equality (objects)', () => {
        expect(exactMatch({ a: 1 }, { a: 1 }).pass).toBe(true);
    });

    it('fails on mismatch', () => {
        const result = exactMatch(42, 43);
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('43');
    });

    it('fails on type mismatch', () => {
        expect(exactMatch('42', 42).pass).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Scorers: jsonShape
// ---------------------------------------------------------------------------

describe('jsonShape', () => {
    it('passes when all keys exist with correct types', () => {
        const result = jsonShape(
            { strategy: 'lfs-migrate', confidence: 0.8, rationale: 'ok' },
            { strategy: 'string', confidence: 'number', rationale: 'string' }
        );
        expect(result.pass).toBe(true);
    });

    it('fails when a key is missing', () => {
        const result = jsonShape({ strategy: 'exclude' }, { strategy: 'string', rationale: 'string' });
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('Missing key "rationale"');
    });

    it('fails on wrong type', () => {
        const result = jsonShape({ confidence: 'high' }, { confidence: 'number' });
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('"confidence"');
    });

    it('fails when actual is not an object', () => {
        expect(jsonShape(null, { a: 'string' }).pass).toBe(false);
        expect(jsonShape('string', { a: 'string' }).pass).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Scorers: enumMatch
// ---------------------------------------------------------------------------

describe('enumMatch', () => {
    it('passes when actual is in allowed values', () => {
        expect(enumMatch('lfs-migrate', ['exclude', 'lfs-migrate']).pass).toBe(true);
        expect(enumMatch('exclude', ['exclude', 'lfs-migrate']).pass).toBe(true);
    });

    it('fails when actual is not in allowed values', () => {
        const result = enumMatch('unknown', ['exclude', 'lfs-migrate']);
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('"unknown"');
    });

    it('is strict — no type coercion', () => {
        expect(enumMatch(1, ['1', 2]).pass).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Scorers: lengthBounds
// ---------------------------------------------------------------------------

describe('lengthBounds', () => {
    it('passes when length is within bounds', () => {
        expect(lengthBounds('hello', { min: 3, max: 10 }).pass).toBe(true);
    });

    it('passes with only min', () => {
        expect(lengthBounds('hello', { min: 3 }).pass).toBe(true);
    });

    it('passes with only max', () => {
        expect(lengthBounds('hi', { max: 100 }).pass).toBe(true);
    });

    it('fails below min', () => {
        const result = lengthBounds('hi', { min: 5 });
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('below min 5');
    });

    it('fails above max', () => {
        const result = lengthBounds('hello world', { max: 5 });
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('exceeds max 5');
    });

    it('fails when actual is not a string', () => {
        expect(lengthBounds(42, { min: 1 }).pass).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Scorers: regexMatch
// ---------------------------------------------------------------------------

describe('regexMatch', () => {
    it('passes when regex matches', () => {
        expect(regexMatch('hello world', /hello/).pass).toBe(true);
        expect(regexMatch('hello world', 'hello').pass).toBe(true);
    });

    it('fails when regex does not match', () => {
        const result = regexMatch('goodbye', /hello/);
        expect(result.pass).toBe(false);
    });

    it('fails when actual is not a string', () => {
        expect(regexMatch(42, /42/).pass).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Scorers: numberRange
// ---------------------------------------------------------------------------

describe('numberRange', () => {
    it('passes when value is within range', () => {
        expect(numberRange(0.5, { min: 0, max: 1 }).pass).toBe(true);
        expect(numberRange(0, { min: 0, max: 1 }).pass).toBe(true);
        expect(numberRange(1, { min: 0, max: 1 }).pass).toBe(true);
    });

    it('fails below min', () => {
        const result = numberRange(-0.1, { min: 0, max: 1 });
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('below min');
    });

    it('fails above max', () => {
        const result = numberRange(1.5, { min: 0, max: 1 });
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('exceeds max');
    });

    it('fails when actual is not a number', () => {
        expect(numberRange('0.5', { min: 0, max: 1 }).pass).toBe(false);
    });

    it('fails on NaN', () => {
        expect(numberRange(NaN, { min: 0, max: 1 }).pass).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Combinators: allOf
// ---------------------------------------------------------------------------

describe('allOf', () => {
    it('passes when all checks pass', () => {
        const result = allOf([
            () => ({ pass: true, reason: 'ok1' }),
            () => ({ pass: true, reason: 'ok2' }),
        ]);
        expect(result.pass).toBe(true);
    });

    it('fails when any check fails', () => {
        const result = allOf([
            () => ({ pass: true, reason: 'ok' }),
            () => ({ pass: false, reason: 'bad thing' }),
        ]);
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('bad thing');
    });

    it('reports count of failures', () => {
        const result = allOf([
            () => ({ pass: false, reason: 'err1' }),
            () => ({ pass: false, reason: 'err2' }),
        ]);
        expect(result.reason).toContain('2 of 2');
    });
});

// ---------------------------------------------------------------------------
// Combinators: anyOf
// ---------------------------------------------------------------------------

describe('anyOf', () => {
    it('passes when at least one check passes', () => {
        const result = anyOf([
            () => ({ pass: false, reason: 'bad' }),
            () => ({ pass: true, reason: 'ok' }),
        ]);
        expect(result.pass).toBe(true);
    });

    it('fails when all checks fail', () => {
        const result = anyOf([
            () => ({ pass: false, reason: 'err1' }),
            () => ({ pass: false, reason: 'err2' }),
        ]);
        expect(result.pass).toBe(false);
        expect(result.reason).toContain('err1');
        expect(result.reason).toContain('err2');
    });
});

// ---------------------------------------------------------------------------
// runEval — handler invocation and aggregation
// ---------------------------------------------------------------------------

describe('runEval', () => {
    // Simple adapter: parses the mock response as JSON and returns it
    const jsonParseAdapter = async ({ provider }) => {
        const { text } = await provider.generate({});
        try { return JSON.parse(text); } catch { return null; }
    };

    const sampleEval = defineEval({
        name: 'test-eval',
        feature: 'test-feature',
        cases: [
            {
                id: 'case-pass',
                input: { x: 1 },
                mockResponse: '{"value": 42}',
                expected: [
                    { scorer: 'jsonShape', args: { value: 'number' } },
                    { scorer: 'numberRange', path: 'value', args: { min: 0, max: 100 } },
                ],
                tags: ['happy-path'],
            },
            {
                id: 'case-fail',
                input: { x: 2 },
                mockResponse: '{"value": 999}',
                expected: [
                    { scorer: 'numberRange', path: 'value', args: { min: 0, max: 100 } },
                ],
                tags: ['edge-case'],
            },
        ],
    });

    it('invokes adapter with mock provider and aggregates results', async () => {
        const result = await runEval(sampleEval, jsonParseAdapter);
        expect(result.feature).toBe('test-feature');
        expect(result.passed).toBe(1);
        expect(result.failed).toBe(1);
        expect(result.cases).toHaveLength(2);
    });

    it('case-pass has all scorer results passing', async () => {
        const result = await runEval(sampleEval, jsonParseAdapter);
        const passCase = result.cases.find(c => c.id === 'case-pass');
        expect(passCase.pass).toBe(true);
        expect(passCase.scorerResults.every(r => r.pass)).toBe(true);
    });

    it('case-fail has failing scorer result', async () => {
        const result = await runEval(sampleEval, jsonParseAdapter);
        const failCase = result.cases.find(c => c.id === 'case-fail');
        expect(failCase.pass).toBe(false);
        expect(failCase.scorerResults.some(r => !r.pass)).toBe(true);
    });

    it('filters by tag when tags option is provided', async () => {
        const result = await runEval(sampleEval, jsonParseAdapter, { tags: ['happy-path'] });
        expect(result.cases).toHaveLength(1);
        expect(result.cases[0].id).toBe('case-pass');
    });

    it('handles adapter throwing — marks case as failed with error', async () => {
        const throwingAdapter = async () => { throw new Error('oops'); };
        const result = await runEval(sampleEval, throwingAdapter);
        expect(result.cases[0].pass).toBe(false);
        expect(result.cases[0].error).toContain('oops');
    });

    it('reports unknown scorer gracefully', async () => {
        const evalWithBadScorer = defineEval({
            name: 'bad',
            feature: 'bad',
            cases: [{
                id: 'c1',
                input: {},
                mockResponse: '{}',
                expected: [{ scorer: 'nonExistentScorer', args: {} }],
            }],
        });
        const result = await runEval(evalWithBadScorer, jsonParseAdapter);
        expect(result.cases[0].pass).toBe(false);
        expect(result.cases[0].scorerResults[0].reason).toContain('Unknown scorer');
    });
});

// ---------------------------------------------------------------------------
// llmJudge — LLM-as-judge scorer (used only in --real mode)
// ---------------------------------------------------------------------------

describe('llmJudge', () => {
    const judgeReturning = (text) => ({ generate: async () => ({ text }) });

    it('passes when the judge returns {"pass": true}', async () => {
        const judge = judgeReturning('{"pass": true, "reason": "meets the rubric"}');
        const result = await llmJudge('some reply', { rubric: 'must be helpful' }, judge);
        expect(result.pass).toBe(true);
        expect(result.reason).toContain('rubric');
    });

    it('fails when the judge returns {"pass": false}', async () => {
        const judge = judgeReturning('{"pass": false, "reason": "off topic"}');
        const result = await llmJudge('some reply', { rubric: 'must be helpful' }, judge);
        expect(result.pass).toBe(false);
        expect(result.reason).toBe('off topic');
    });

    it('tolerates a judge that wraps the JSON in code fences', async () => {
        const judge = judgeReturning('```json\n{"pass": true, "reason": "ok"}\n```');
        const result = await llmJudge('reply', { rubric: 'r' }, judge);
        expect(result.pass).toBe(true);
    });

    it('fails closed when the judge call throws', async () => {
        const judge = { generate: async () => { throw new Error('rate limited'); } };
        const result = await llmJudge('reply', { rubric: 'r' }, judge);
        expect(result.pass).toBe(false);
        expect(result.reason).toMatch(/judge/i);
    });

    it('fails closed when no judge provider is supplied', async () => {
        const result = await llmJudge('reply', { rubric: 'r' }, null);
        expect(result.pass).toBe(false);
        expect(result.reason).toMatch(/judge/i);
    });
});

// ---------------------------------------------------------------------------
// runEval — real-provider override + llmJudge descriptors (--real mode)
// ---------------------------------------------------------------------------

describe('runEval (--real mode)', () => {
    // Adapter mirrors the real adapters: it sends the prompt to whatever
    // provider it is given and parses the reply.
    const chatAdapter = async ({ provider }) => {
        const { text } = await provider.generate({ prompt: 'built-prompt' });
        try { return JSON.parse(text); } catch { return null; }
    };

    const evalDef = defineEval({
        name: 'real-eval',
        feature: 'real-feature',
        cases: [{
            id: 'real-1',
            input: { message: 'why did my migration fail?' },
            mockResponse: '{"reply":"MOCK reply"}',
            expected: [{ scorer: 'jsonShape', args: { reply: 'string' } }],
            judge: [{ scorer: 'llmJudge', path: 'reply', args: { rubric: 'mentions git-lfs' } }],
        }],
    });

    it('routes the adapter to the real provider instead of the mock response', async () => {
        const realProvider = { generate: async () => ({ text: '{"reply":"REAL model reply"}' }) };
        const judge = { generate: async () => ({ text: '{"pass": true, "reason": "ok"}' }) };

        const result = await runEval(evalDef, chatAdapter, { provider: realProvider, judge });

        const c = result.cases[0];
        expect(c.pass).toBe(true);
        // The llmJudge descriptor ran (real mode), in addition to jsonShape.
        const judgeResult = c.scorerResults.find(r => r.scorer === 'llmJudge');
        expect(judgeResult).toBeTruthy();
        expect(judgeResult.pass).toBe(true);
    });

    it('a failing judge verdict fails the case in real mode', async () => {
        const realProvider = { generate: async () => ({ text: '{"reply":"unrelated"}' }) };
        const judge = { generate: async () => ({ text: '{"pass": false, "reason": "no git-lfs mention"}' }) };

        const result = await runEval(evalDef, chatAdapter, { provider: realProvider, judge });
        expect(result.cases[0].pass).toBe(false);
    });

    it('skips llmJudge descriptors in mock mode (no real provider)', async () => {
        const result = await runEval(evalDef, chatAdapter); // mock mode
        const c = result.cases[0];
        // Only the deterministic `expected` scorers run; judge is skipped.
        expect(c.scorerResults.some(r => r.scorer === 'llmJudge')).toBe(false);
        expect(c.pass).toBe(true);
    });

    const evalWithMockOnly = defineEval({
        name: 'mixed',
        feature: 'mixed',
        cases: [
            { id: 'real-ok', input: {}, mockResponse: '{"reply":"hi"}', expected: [{ scorer: 'jsonShape', args: { reply: 'string' } }] },
            { id: 'mock-only', input: {}, mockResponse: 'garbage', expected: [{ scorer: 'exactMatch', args: null }], mockOnly: true },
        ],
    });

    it('skips mockOnly cases in real mode', async () => {
        const realProvider = { generate: async () => ({ text: '{"reply":"real"}' }) };
        const result = await runEval(evalWithMockOnly, chatAdapter, { provider: realProvider });
        expect(result.cases.map(c => c.id)).toEqual(['real-ok']);
    });

    it('runs mockOnly cases in mock mode', async () => {
        const result = await runEval(evalWithMockOnly, chatAdapter);
        expect(result.cases).toHaveLength(2);
        expect(result.cases.every(c => c.pass)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// diffAgainstBaseline
// ---------------------------------------------------------------------------

describe('diffAgainstBaseline', () => {
    const current = [
        {
            feature: 'feat-a',
            cases: [
                { id: 'c1', pass: true },   // was passing → regression? no, still passing
                { id: 'c2', pass: false },  // was passing → regression
                { id: 'c3', pass: true },   // was failing → improvement
                { id: 'c4', pass: false },  // was failing → unchanged
                { id: 'c5', pass: true },   // new case (not in baseline)
            ],
        },
    ];

    const baseline = [
        {
            feature: 'feat-a',
            cases: [
                { id: 'c1', pass: true },
                { id: 'c2', pass: true },
                { id: 'c3', pass: false },
                { id: 'c4', pass: false },
                // c5 is absent → new case
            ],
        },
    ];

    it('identifies regressions (passed → failed)', () => {
        const diff = diffAgainstBaseline(current, baseline);
        expect(diff.regressions).toHaveLength(1);
        expect(diff.regressions[0].caseId).toBe('c2');
    });

    it('identifies improvements (failed → passed)', () => {
        const diff = diffAgainstBaseline(current, baseline);
        expect(diff.improvements).toHaveLength(1);
        expect(diff.improvements[0].caseId).toBe('c3');
    });

    it('places unchanged and new cases in unchanged', () => {
        const diff = diffAgainstBaseline(current, baseline);
        // c1 unchanged (pass→pass), c4 unchanged (fail→fail), c5 new
        const unchangedIds = diff.unchanged.map(u => u.caseId);
        expect(unchangedIds).toContain('c1');
        expect(unchangedIds).toContain('c4');
        expect(unchangedIds).toContain('c5');
    });

    it('returns empty arrays when no changes', () => {
        const diff = diffAgainstBaseline(current, current);
        expect(diff.regressions).toHaveLength(0);
        expect(diff.improvements).toHaveLength(0);
    });
});
