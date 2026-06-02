// @vitest-environment node
/**
 * Tests for server/lib/providers/openai.js
 *
 * Verifies:
 *  - generate() posts to /chat/completions with Authorization: Bearer header
 *  - generate({ schema }) uses response_format json_schema and parses JSON
 *  - embed() posts to /embeddings, returns array
 *  - generateStream() yields text deltas from SSE
 *  - 401 / 429 / 500 / 503 responses map to correct AIError codes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../../lib/providers/openai.js';
import { AIError, AI_ERROR_CODE } from '../../lib/ai-provider.js';

// ---------------------------------------------------------------------------
// Helpers to build mock fetch responses
// ---------------------------------------------------------------------------

function jsonResponse(body, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        body: null,
    });
}

function errorResponse(status, message, type) {
    return jsonResponse({ error: { message, type } }, status);
}

/**
 * Build a mock fetch that returns a streaming SSE response.
 * @param {string[]} deltas — list of text chunks to emit
 */
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

    return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        body: { getReader: () => reader },
    });
}

// ---------------------------------------------------------------------------
// Provider instance
// ---------------------------------------------------------------------------

let provider;

beforeEach(() => {
    vi.unstubAllGlobals();
    provider = new OpenAIProvider({ apiKey: 'test-openai-key', model: 'gpt-test', embeddingModel: 'embed-test' });
});

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

describe('OpenAIProvider.generate()', () => {
    it('posts to /chat/completions with Authorization: Bearer', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'Hello!' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const result = await provider.generate({ prompt: 'say hi' });

        expect(result.text).toBe('Hello!');
        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toContain('/chat/completions');
        expect(opts.headers['Authorization']).toBe('Bearer test-openai-key');
    });

    it('sends the prompt as a user message', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'ok' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await provider.generate({ prompt: 'my prompt' });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.messages).toContainEqual({ role: 'user', content: 'my prompt' });
    });

    it('sends systemPrompt as a system message', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'ok' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await provider.generate({ prompt: 'p', systemPrompt: 'You are a bot.' });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a bot.' });
    });

    it('strips markdown code fences from response', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: '```json\n{"k":1}\n```' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const result = await provider.generate({ prompt: 'json' });
        expect(result.text).toBe('{"k":1}');
    });

    it('with schema: uses response_format json_schema and returns parsed', async () => {
        const payload = { answer: 42 };
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: JSON.stringify(payload) } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const schema = { type: 'object', properties: { answer: { type: 'number' } } };
        const result = await provider.generate({ prompt: 'give json', schema });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.response_format).toMatchObject({ type: 'json_schema' });
        expect(result.parsed).toEqual(payload);
        expect(result.text).toBe(JSON.stringify(payload));
    });

    it('with schema: adds JSON instruction to system prompt', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: '{"x":1}' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await provider.generate({ schema: { type: 'object' }, systemPrompt: 'Be helpful.' });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        const systemMsg = body.messages.find(m => m.role === 'system');
        expect(systemMsg.content).toContain('Be helpful.');
        expect(systemMsg.content).toContain('JSON');
    });

    it('with schema: throws INVALID_RESPONSE when parse fails', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'not json{{' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await expect(provider.generate({ schema: { type: 'object' } }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.INVALID_RESPONSE });
    });

    it('maps 401 to AUTH error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(401, 'Invalid API key'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.AUTH });
    });

    it('maps 429 to RATE_LIMITED (retryable), not QUOTA', async () => {
        vi.stubGlobal('fetch', () => errorResponse(429, 'Rate limit exceeded'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.RATE_LIMITED });
    });

    it('honours Retry-After on a 429 (retryAfterMs)', async () => {
        vi.stubGlobal('fetch', () => Promise.resolve({
            ok: false,
            status: 429,
            headers: { get: (k) => (String(k).toLowerCase() === 'retry-after' ? '2' : null) },
            json: () => Promise.resolve({ error: { message: 'slow down' } }),
            body: null,
        }));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.RATE_LIMITED, retryAfterMs: 2000 });
    });

    it('maps 403 to UNKNOWN, not AUTH (region/policy/access, not a bad key)', async () => {
        vi.stubGlobal('fetch', () => errorResponse(403, 'Country, region, or territory not supported'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.UNKNOWN, status: 403 });
    });

    it('maps 500 to UNKNOWN error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(500, 'Internal server error'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.UNKNOWN });
    });

    it('maps 503 to OVERLOAD error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(503, 'Service unavailable'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.OVERLOAD });
    });

    it('uses parts array as multi-part content blocks in user message', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'ok' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await provider.generate({ parts: [{ text: 'part1' }, { text: 'part2' }] });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        const userMsg = body.messages.find(m => m.role === 'user');
        // Each part must be a distinct content block, not a joined string
        expect(Array.isArray(userMsg.content)).toBe(true);
        expect(userMsg.content).toHaveLength(2);
        expect(userMsg.content[0]).toEqual({ type: 'text', text: 'part1' });
        expect(userMsg.content[1]).toEqual({ type: 'text', text: 'part2' });
    });

    it('uses modelOverride when provided', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ choices: [{ message: { content: 'ok' } }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await provider.generate({ prompt: 'test', modelOverride: 'gpt-override' });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.model).toBe('gpt-override');
    });
});

// ---------------------------------------------------------------------------
// embed()
// ---------------------------------------------------------------------------

describe('OpenAIProvider.embed()', () => {
    it('posts to /embeddings and returns the embedding array', async () => {
        const embedding = [0.1, 0.2, 0.3];
        const mockFetch = vi.fn(() =>
            jsonResponse({ data: [{ embedding }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const result = await provider.embed('hello world');

        expect(result).toEqual(embedding);
        const [url] = mockFetch.mock.calls[0];
        expect(url).toContain('/embeddings');
        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.input).toBe('hello world');
        expect(body.model).toBe('embed-test');
    });

    it('throws INVALID_RESPONSE when embedding is missing from response', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ data: [] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await expect(provider.embed('text'))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.INVALID_RESPONSE });
    });

    it('maps 401 to AUTH error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(401, 'Unauthorized'));
        await expect(provider.embed('text'))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.AUTH });
    });
});

// ---------------------------------------------------------------------------
// generateStream()
// ---------------------------------------------------------------------------

describe('OpenAIProvider.generateStream()', () => {
    it('yields text deltas from the SSE stream', async () => {
        vi.stubGlobal('fetch', () => sseResponse(['hello', ' ', 'world']));

        const chunks = [];
        for await (const chunk of provider.generateStream({ prompt: 'stream me' })) {
            chunks.push(chunk);
        }

        expect(chunks).toEqual(['hello', ' ', 'world']);
    });

    it('sends stream: true in request body', async () => {
        const mockFetch = vi.fn(() => sseResponse([]));
        vi.stubGlobal('fetch', mockFetch);

        for await (const _ of provider.generateStream({ prompt: 'test' })) { /* drain */ }

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.stream).toBe(true);
    });

    it('maps 401 response to AUTH error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(401, 'Unauthorized'));
        const gen = provider.generateStream({ prompt: 'test' });
        await expect(gen.next()).rejects.toMatchObject({ code: AI_ERROR_CODE.AUTH });
    });
});
