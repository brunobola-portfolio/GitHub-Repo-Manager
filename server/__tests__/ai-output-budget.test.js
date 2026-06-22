// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import {
    resolveMaxOutputTokens,
    DEFAULT_MAX_OUTPUT_TOKENS,
    MIN_MAX_OUTPUT_TOKENS,
    MAX_MAX_OUTPUT_TOKENS,
} from '../lib/ai-output-budget.js';

const ORIG = { ...process.env };
afterEach(() => { process.env = { ...ORIG }; });

describe('resolveMaxOutputTokens', () => {
    it('defaults when AI_MAX_OUTPUT_TOKENS is unset', () => {
        delete process.env.AI_MAX_OUTPUT_TOKENS;
        expect(resolveMaxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });

    it('honors a valid override', () => {
        process.env.AI_MAX_OUTPUT_TOKENS = '1024';
        expect(resolveMaxOutputTokens()).toBe(1024);
    });

    it('clamps absurdly large values to the ceiling', () => {
        process.env.AI_MAX_OUTPUT_TOKENS = '999999';
        expect(resolveMaxOutputTokens()).toBe(MAX_MAX_OUTPUT_TOKENS);
    });

    it('clamps too-small values to the floor', () => {
        process.env.AI_MAX_OUTPUT_TOKENS = '10';
        expect(resolveMaxOutputTokens()).toBe(MIN_MAX_OUTPUT_TOKENS);
    });

    it('falls back to the default on non-numeric / invalid input', () => {
        process.env.AI_MAX_OUTPUT_TOKENS = 'abc';
        expect(resolveMaxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
        process.env.AI_MAX_OUTPUT_TOKENS = '-5';
        expect(resolveMaxOutputTokens()).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });
});
