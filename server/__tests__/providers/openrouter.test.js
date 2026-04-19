// @vitest-environment node
/**
 * Tests for server/lib/providers/openrouter.js
 *
 * Verifies:
 *  - Base URL is openrouter.ai/api/v1
 *  - Uses same OpenAI-compatible protocol
 *  - embed() throws NOT_FOUND with helpful message
 *  - generate() and generateStream() work via OpenAI base class
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from '../../lib/providers/openrouter.js';
import { AIError, AI_ERROR_CODE } from '../../lib/ai-provider.js';

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

function jsonResponse(body, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        body: null,
    });
}

function errorResponse(status, message) {
    return jsonResponse({ error: { message } }, status);
}

function sseResponse(deltas) {
    const lines = deltas.map(d =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n`
    );
    lines.push('data: [DONE]\n');
    const sseText = lines.join('');
    const encoder = new TextEncoder();
    const uint8 = encoder.encode(sseText);
    let offset = 0;
    const reader = {
        read: vi.fn(async () => {
            if (offset >= uint8.length) return { done: true, value: undefined };
            const chunk = uint8.slice(offset, offset + 64);
            offset += 64;
            return { done: false, value: chunk };
        }),
        releaseLock: vi.fn(),
    };
    return Promise.resolve({ ok: true, status: 200, body: { getReader: () => reader } });
}

// ---------------------------------------------------------------------------
// Provider instance
// ---------------------------------------------------------------------------

let provider;

beforeEach(() => {
    vi.unstubAllGlobals();
    provider = new OpenRouterProvider({ apiKey: 'test-or-key' });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('OpenRouterProvider configuration', () => {
    it('uses openrouter.ai/api/v1 as base URL', () => {
        expect(provider._baseURL).toBe('https://openrouter.ai/api/v1');
    });

    it('defaults to anthropic/claude-sonnet-4-6 model', () => {
        expect(provider._modelName).toBe('anthropic/claude-sonnet-4-6');
    });

    it('accepts a custom model', () => {
        const p = new OpenRouterProvider({ apiKey: 'k', model: 'openai/gpt-4o' });
        expect(p._modelName).toBe('openai/gpt-4o');
    });

    it('accepts a custom baseURL', () => {
        const p = new OpenRouterProvider({ apiKey: 'k', baseURL: 'https://custom.openrouter.ai/v1' });
        expect(p._baseURL).toBe('https://custom.openrouter.ai/v1');
    });
});

// ---------------------------------------------------------------------------
// generate() — via OpenAI base class
// ---------------------------------------------------------------------------

describe('OpenRouterProvider.generate()', () => {
    it('posts to the openrouter /chat/completions endpoint', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'Hi from OR' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const result = await provider.generate({ prompt: 'say hi' });

        expect(result.text).toBe('Hi from OR');
        const [url] = mockFetch.mock.calls[0];
        expect(url).toContain('openrouter.ai');
        expect(url).toContain('/chat/completions');
    });

    it('sends Authorization: Bearer header', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'ok' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await provider.generate({ prompt: 'test' });

        const opts = mockFetch.mock.calls[0][1];
        expect(opts.headers['Authorization']).toBe('Bearer test-or-key');
    });

    it('maps 401 to AUTH error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(401, 'Invalid key'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.AUTH });
    });
});

// ---------------------------------------------------------------------------
// embed() — overridden
// ---------------------------------------------------------------------------

describe('OpenRouterProvider.embed()', () => {
    it('throws AIError with NOT_FOUND code', async () => {
        await expect(provider.embed('text'))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.NOT_FOUND });
    });

    it('message mentions configure a separate embedding provider', async () => {
        try {
            await provider.embed('text');
        } catch (err) {
            expect(err).toBeInstanceOf(AIError);
            expect(err.message).toMatch(/separate embedding provider/i);
        }
    });

    it('never calls fetch for embed', async () => {
        const mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);

        try { await provider.embed('text'); } catch { /* expected */ }

        expect(mockFetch).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// generateStream() — via OpenAI base class
// ---------------------------------------------------------------------------

describe('OpenRouterProvider.generateStream()', () => {
    it('yields text deltas from SSE stream', async () => {
        vi.stubGlobal('fetch', () => sseResponse(['hello', ' world']));

        const chunks = [];
        for await (const chunk of provider.generateStream({ prompt: 'test' })) {
            chunks.push(chunk);
        }

        expect(chunks).toEqual(['hello', ' world']);
    });
});
