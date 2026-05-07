// @vitest-environment node
/**
 * Tests for server/lib/ai-error-format.js
 *
 * The formatter is the user-facing surface of /api/user/ai-config/test, so
 * it's worth pinning the contract: stable shape, code-specific titles,
 * actionable hints, and graceful degradation when the upstream gave us
 * nothing structured to work with.
 */

import { describe, it, expect } from 'vitest';
import { AIError, AI_ERROR_CODE } from '../lib/ai-provider.js';
import { formatAIErrorForUser, getProviderLabel } from '../lib/ai-error-format.js';

// ---------------------------------------------------------------------------
// formatAIErrorForUser
// ---------------------------------------------------------------------------

describe('formatAIErrorForUser', () => {
    it('returns a stable shape for an AUTH error', () => {
        const err = new AIError({ code: AI_ERROR_CODE.AUTH, message: 'Invalid API key', status: 401 });
        const out = formatAIErrorForUser(err, { providerName: 'OpenAI', model: 'gpt-4o', kind: 'completion' });

        expect(out).toMatchObject({
            ok: false,
            code: AI_ERROR_CODE.AUTH,
            title: 'Authentication failed',
            error: 'Invalid API key',
            message: 'Invalid API key',
            httpStatus: 401,
            providerName: 'OpenAI',
            model: 'gpt-4o',
            kind: 'completion',
            upstreamProvider: null,
            upstreamRaw: null,
            errorType: null,
        });
        expect(out.hint).toMatch(/api key/i);
    });

    it('produces a `:free`-specific hint for OpenRouter free models', () => {
        const err = new AIError({
            code: AI_ERROR_CODE.UNKNOWN,
            message: 'Provider returned error',
            status: 500,
            details: { upstreamProvider: 'Together', upstreamRaw: '{"err":"oom"}' },
        });
        const out = formatAIErrorForUser(err, {
            providerName: 'OpenRouter',
            model: 'qwen/qwen3-coder:free',
            kind: 'completion',
        });

        expect(out.upstreamProvider).toBe('Together');
        expect(out.upstreamRaw).toBe('{"err":"oom"}');
        expect(out.hint).toMatch(/free openrouter/i);
        expect(out.hint).toMatch(/paid model/i);
    });

    it('mentions the upstream provider in OVERLOAD hints', () => {
        const err = new AIError({
            code: AI_ERROR_CODE.OVERLOAD,
            message: 'overloaded',
            status: 529,
            details: { upstreamProvider: 'Anthropic' },
        });
        const out = formatAIErrorForUser(err, { providerName: 'OpenRouter', model: 'anthropic/claude-3.5-sonnet' });

        expect(out.title).toBe('Provider temporarily overloaded');
        expect(out.hint).toMatch(/Anthropic/);
        expect(out.hint).toMatch(/OpenRouter/);
    });

    it('redacts API keys leaking in the message', () => {
        const err = new Error('failed: key sk-abcdefghijklmnop123');
        err.status = 500;
        const out = formatAIErrorForUser(err, { providerName: 'OpenAI', model: 'gpt-4o' });

        expect(out.message).not.toContain('sk-abcdefghijklmnop');
        expect(out.message).toMatch(/sk-\[REDACTED\]/);
    });

    it('falls back gracefully when err is a bare Error with no code', () => {
        const err = new Error('boom');
        const out = formatAIErrorForUser(err);

        expect(out).toMatchObject({
            ok: false,
            code: AI_ERROR_CODE.UNKNOWN,
            title: 'Provider call failed',
            message: 'boom',
            httpStatus: null,
            providerName: null,
            model: null,
            kind: null,
        });
    });

    it('handles a totally empty input without throwing', () => {
        const out = formatAIErrorForUser(null);
        expect(out.ok).toBe(false);
        expect(out.message).toBe('Test call failed');
        expect(out.code).toBe(AI_ERROR_CODE.UNKNOWN);
    });

    it('extracts errorType for Anthropic errors', () => {
        const err = new AIError({
            code: AI_ERROR_CODE.AUTH,
            message: 'invalid x-api-key',
            status: 401,
            details: { errorType: 'authentication_error' },
        });
        const out = formatAIErrorForUser(err, { providerName: 'Anthropic' });
        expect(out.errorType).toBe('authentication_error');
    });

    it('truncates long messages to 200 chars', () => {
        const longMsg = 'x'.repeat(500);
        const err = new AIError({ code: AI_ERROR_CODE.UNKNOWN, message: longMsg });
        const out = formatAIErrorForUser(err);
        expect(out.message.length).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// getProviderLabel
// ---------------------------------------------------------------------------

describe('getProviderLabel', () => {
    it('maps known constructors to friendly labels', () => {
        const fakeProvider = Object.create({ constructor: { name: 'OpenRouterProvider' } });
        expect(getProviderLabel(fakeProvider)).toBe('OpenRouter');
    });

    it('falls back to constructor name for unknown providers', () => {
        const fakeProvider = Object.create({ constructor: { name: 'BananaProvider' } });
        expect(getProviderLabel(fakeProvider)).toBe('BananaProvider');
    });

    it('returns null for a null provider', () => {
        expect(getProviderLabel(null)).toBeNull();
    });
});
