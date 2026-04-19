// @vitest-environment node
/**
 * Tests for server/lib/providers/local.js
 *
 * Verifies:
 *  - Uses custom endpointUrl as base URL
 *  - No Auth header is NOT required — sends 'Bearer local' by default
 *  - Custom apiKey is used if provided
 *  - generate() and embed() work via OpenAI base class
 *  - generateStream() works
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalProvider } from '../../lib/providers/local.js';
import { AI_ERROR_CODE } from '../../lib/ai-provider.js';

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
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('LocalProvider configuration', () => {
    it('defaults to http://localhost:1234/v1', () => {
        const p = new LocalProvider({});
        expect(p._baseURL).toBe('http://localhost:1234/v1');
    });

    it('accepts a custom endpointUrl', () => {
        const p = new LocalProvider({ endpointUrl: 'http://localhost:11434/v1' });
        expect(p._baseURL).toBe('http://localhost:11434/v1');
    });

    it('defaults apiKey to "local"', () => {
        const p = new LocalProvider({});
        expect(p._apiKey).toBe('local');
    });

    it('accepts a custom apiKey', () => {
        const p = new LocalProvider({ apiKey: 'my-lmstudio-key' });
        expect(p._apiKey).toBe('my-lmstudio-key');
    });
});

describe('LocalProvider: no required auth header', () => {
    it('sends Bearer local when no apiKey provided', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'ok' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const provider = new LocalProvider({ endpointUrl: 'http://localhost:1234/v1' });
        await provider.generate({ prompt: 'test' });

        const opts = mockFetch.mock.calls[0][1];
        // Should send Bearer local (default)
        expect(opts.headers['Authorization']).toBe('Bearer local');
    });

    it('uses custom endpoint URL in request', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'ok' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const provider = new LocalProvider({ endpointUrl: 'http://localhost:11434/v1' });
        await provider.generate({ prompt: 'hi' });

        const [url] = mockFetch.mock.calls[0];
        expect(url).toContain('localhost:11434');
        expect(url).toContain('/chat/completions');
    });
});

describe('LocalProvider.generate()', () => {
    it('returns text from the local model', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'local response' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const provider = new LocalProvider({});
        const result = await provider.generate({ prompt: 'hello' });

        expect(result.text).toBe('local response');
    });

    it('maps errors via toAIError', async () => {
        vi.stubGlobal('fetch', () => errorResponse(500, 'Internal error'));

        const provider = new LocalProvider({});
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.UNKNOWN });
    });
});

describe('LocalProvider.embed()', () => {
    it('posts to /embeddings and returns array when model supports it', async () => {
        const embedding = [0.5, 0.6, 0.7];
        const mockFetch = vi.fn(() =>
            jsonResponse({ data: [{ embedding }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const provider = new LocalProvider({ embeddingModel: 'nomic-embed-text' });
        const result = await provider.embed('hello');

        expect(result).toEqual(embedding);
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.model).toBe('nomic-embed-text');
    });
});

describe('LocalProvider.generateStream()', () => {
    it('yields text deltas from SSE stream', async () => {
        vi.stubGlobal('fetch', () => sseResponse(['local', ' stream']));

        const provider = new LocalProvider({});
        const chunks = [];
        for await (const chunk of provider.generateStream({ prompt: 'test' })) {
            chunks.push(chunk);
        }

        expect(chunks).toEqual(['local', ' stream']);
    });
});
