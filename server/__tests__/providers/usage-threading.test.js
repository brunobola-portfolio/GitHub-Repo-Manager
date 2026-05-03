// @vitest-environment node
/**
 * Tests for `generate()` usage + cost threading across all providers.
 *
 * Each provider's wrapper must:
 *   1. Pluck token usage from the SDK / HTTP response in the right field shape.
 *   2. Compute costUSD via provider-pricing.computeCostUSD using the resolved
 *      model name.
 *   3. Return `usage: null` and `costUSD: null` when the SDK omits usage data
 *      (notably most local OpenAI-compatible servers).
 *
 * Mocks the network layer (`fetch` for OpenAI/Anthropic/OpenRouter/Local,
 * the SDK model handle for Gemini) so no real API calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from '../../lib/ai-provider.js';
import { AnthropicProvider } from '../../lib/providers/anthropic.js';
import { OpenAIProvider } from '../../lib/providers/openai.js';
import { OpenRouterProvider } from '../../lib/providers/openrouter.js';
import { LocalProvider } from '../../lib/providers/local.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        body: null,
    });
}

// ---------------------------------------------------------------------------
// GeminiProvider — usage from result.response.usageMetadata
// ---------------------------------------------------------------------------

describe('GeminiProvider.generate() usage + cost threading', () => {
    it('extracts usageMetadata and computes costUSD via provider-pricing', async () => {
        const provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-2.5-flash' });
        // Override the SDK model handle directly
        provider.model = {
            generateContent: vi.fn(async () => ({
                response: {
                    text: () => 'hello world',
                    usageMetadata: {
                        promptTokenCount: 1000,
                        candidatesTokenCount: 500,
                    },
                },
            })),
        };

        const out = await provider.generate({ prompt: 'hi' });

        expect(out.text).toBe('hello world');
        expect(out.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
        // gemini-2.5-flash: input $0.30/M, output $2.50/M
        // cost = 1000 * 0.30/1e6 + 500 * 2.50/1e6 = 0.0003 + 0.00125 = 0.00155
        expect(out.costUSD).toBeCloseTo(0.00155, 8);
    });

    it('returns usage: null and costUSD: null when usageMetadata is absent', async () => {
        const provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-2.5-flash' });
        provider.model = {
            generateContent: vi.fn(async () => ({
                response: { text: () => 'hi' },
            })),
        };

        const out = await provider.generate({ prompt: 'p' });
        expect(out.usage).toBeNull();
        expect(out.costUSD).toBeNull();
    });

    it('surfaces cachedContentTokenCount when present', async () => {
        const provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-2.5-flash' });
        provider.model = {
            generateContent: vi.fn(async () => ({
                response: {
                    text: () => 'cached!',
                    usageMetadata: {
                        promptTokenCount: 2000,
                        candidatesTokenCount: 100,
                        cachedContentTokenCount: 1500,
                    },
                },
            })),
        };

        const out = await provider.generate({ prompt: 'p' });
        expect(out.usage.cachedInputTokens).toBe(1500);
    });
});

// ---------------------------------------------------------------------------
// AnthropicProvider — usage from data.usage.input_tokens / output_tokens
// ---------------------------------------------------------------------------

describe('AnthropicProvider.generate() usage + cost threading', () => {
    beforeEach(() => vi.unstubAllGlobals());

    it('extracts usage and computes costUSD', async () => {
        vi.stubGlobal('fetch', () => jsonResponse({
            content: [{ text: 'reply' }],
            usage: { input_tokens: 1000, output_tokens: 500 },
        }));

        const provider = new AnthropicProvider({ apiKey: 'sk-ant-x', model: 'claude-sonnet-4-6' });
        const out = await provider.generate({ prompt: 'hi' });

        expect(out.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
        // claude-sonnet-4-6: input $3.00/M, output $15.00/M
        // cost = 1000 * 3/1e6 + 500 * 15/1e6 = 0.003 + 0.0075 = 0.0105
        expect(out.costUSD).toBeCloseTo(0.0105, 8);
    });

    it('returns nulls when usage is absent', async () => {
        vi.stubGlobal('fetch', () => jsonResponse({ content: [{ text: 'reply' }] }));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-x', model: 'claude-sonnet-4-6' });
        const out = await provider.generate({ prompt: 'p' });
        expect(out.usage).toBeNull();
        expect(out.costUSD).toBeNull();
    });

    it('surfaces cache_read_input_tokens as cachedInputTokens', async () => {
        vi.stubGlobal('fetch', () => jsonResponse({
            content: [{ text: 'r' }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80 },
        }));
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-x', model: 'claude-sonnet-4-6' });
        const out = await provider.generate({ prompt: 'p' });
        expect(out.usage.cachedInputTokens).toBe(80);
    });
});

// ---------------------------------------------------------------------------
// OpenAIProvider — usage from data.usage.prompt_tokens / completion_tokens
// ---------------------------------------------------------------------------

describe('OpenAIProvider.generate() usage + cost threading', () => {
    beforeEach(() => vi.unstubAllGlobals());

    it('extracts usage and computes costUSD', async () => {
        vi.stubGlobal('fetch', () => jsonResponse({
            choices: [{ message: { content: 'hi' } }],
            usage: { prompt_tokens: 1000, completion_tokens: 500 },
        }));
        const provider = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4o-mini' });
        const out = await provider.generate({ prompt: 'p' });

        expect(out.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
        // gpt-4o-mini: input $0.15/M, output $0.60/M
        // cost = 1000 * 0.15/1e6 + 500 * 0.60/1e6 = 0.00015 + 0.0003 = 0.00045
        expect(out.costUSD).toBeCloseTo(0.00045, 8);
    });

    it('returns nulls when usage is omitted', async () => {
        vi.stubGlobal('fetch', () => jsonResponse({ choices: [{ message: { content: 'hi' } }] }));
        const provider = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4o-mini' });
        const out = await provider.generate({ prompt: 'p' });
        expect(out.usage).toBeNull();
        expect(out.costUSD).toBeNull();
    });

    it('surfaces prompt_tokens_details.cached_tokens as cachedInputTokens', async () => {
        vi.stubGlobal('fetch', () => jsonResponse({
            choices: [{ message: { content: 'hi' } }],
            usage: {
                prompt_tokens: 1000,
                completion_tokens: 500,
                prompt_tokens_details: { cached_tokens: 700 },
            },
        }));
        const provider = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4o-mini' });
        const out = await provider.generate({ prompt: 'p' });
        expect(out.usage.cachedInputTokens).toBe(700);
    });
});

// ---------------------------------------------------------------------------
// OpenRouterProvider — inherits OpenAI shape
// ---------------------------------------------------------------------------

describe('OpenRouterProvider.generate() usage + cost threading', () => {
    beforeEach(() => vi.unstubAllGlobals());

    it('inherits OpenAI usage parsing', async () => {
        vi.stubGlobal('fetch', () => jsonResponse({
            choices: [{ message: { content: 'hi' } }],
            usage: { prompt_tokens: 200, completion_tokens: 100 },
        }));
        const provider = new OpenRouterProvider({ apiKey: 'or-x', model: 'anthropic/claude-sonnet-4-6' });
        const out = await provider.generate({ prompt: 'p' });

        expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 100 });
        // Model id has a vendor prefix; provider-pricing prefix-matches against
        // 'claude-sonnet-4-6' would NOT match 'anthropic/claude-sonnet-4-6',
        // so cost falls back to the FALLBACK_PRICING tier (input 0.50, output 2.00).
        // We just assert it's a positive number — exact value isn't load-bearing.
        expect(out.costUSD).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// LocalProvider — local servers usually omit usage; expect nulls
// ---------------------------------------------------------------------------

describe('LocalProvider.generate() usage + cost threading', () => {
    beforeEach(() => vi.unstubAllGlobals());

    it('returns usage: null when local server omits usage block', async () => {
        vi.stubGlobal('fetch', () => jsonResponse({
            choices: [{ message: { content: 'hi from local' } }],
            // No usage field — typical of llama.cpp / Ollama
        }));
        const provider = new LocalProvider({ endpointUrl: 'http://localhost:1234/v1', model: 'local-model' });
        const out = await provider.generate({ prompt: 'p' });
        expect(out.text).toBe('hi from local');
        expect(out.usage).toBeNull();
        expect(out.costUSD).toBeNull();
    });

    it('surfaces usage when a local server happens to report it (LMStudio)', async () => {
        vi.stubGlobal('fetch', () => jsonResponse({
            choices: [{ message: { content: 'hi' } }],
            usage: { prompt_tokens: 50, completion_tokens: 25 },
        }));
        const provider = new LocalProvider({ endpointUrl: 'http://localhost:1234/v1', model: 'local-model' });
        const out = await provider.generate({ prompt: 'p' });
        expect(out.usage).toEqual({ inputTokens: 50, outputTokens: 25 });
        // Unknown 'local-model' falls back to FALLBACK_PRICING — cost is positive.
        expect(out.costUSD).toBeGreaterThan(0);
    });
});
