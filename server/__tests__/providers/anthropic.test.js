// @vitest-environment node
/**
 * Tests for server/lib/providers/anthropic.js
 *
 * Verifies:
 *  - generate() posts to /v1/messages with x-api-key header
 *  - generate({ schema }) adds JSON instruction to system prompt + strips fences + returns parsed
 *  - embed() throws AIError with NOT_FOUND code
 *  - generateStream() yields text deltas from Anthropic SSE
 *  - 401 / 529 responses map via correct AIError codes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../../lib/providers/anthropic.js';
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

function errorResponse(status, message, type) {
    return jsonResponse({ error: { message, type } }, status);
}

/**
 * Build a mock fetch that returns a streaming Anthropic SSE response.
 * Anthropic SSE format:
 *   event: content_block_delta
 *   data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
 */
function anthropicSseResponse(textChunks) {
    const lines = [];
    for (const text of textChunks) {
        lines.push(
            `data: ${JSON.stringify({
                type: 'content_block_delta',
                delta: { type: 'text_delta', text },
            })}\n`
        );
    }
    // Add a final message_stop event
    lines.push('data: {"type":"message_stop"}\n');

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
        body: { getReader: () => reader },
    });
}

// ---------------------------------------------------------------------------
// Provider instance
// ---------------------------------------------------------------------------

let provider;

beforeEach(() => {
    vi.unstubAllGlobals();
    provider = new AnthropicProvider({ apiKey: 'test-anthropic-key', model: 'claude-test' });
});

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

describe('AnthropicProvider.generate()', () => {
    it('posts to /v1/messages with x-api-key header', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ content: [{ text: 'Hello!' }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const result = await provider.generate({ prompt: 'say hi' });

        expect(result.text).toBe('Hello!');
        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toContain('/v1/messages');
        expect(opts.headers['x-api-key']).toBe('test-anthropic-key');
        expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    });

    it('sends the prompt as a user message', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ content: [{ text: 'ok' }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await provider.generate({ prompt: 'my prompt' });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.messages).toContainEqual({ role: 'user', content: 'my prompt' });
    });

    it('sends systemPrompt as top-level system field', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ content: [{ text: 'ok' }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await provider.generate({ prompt: 'p', systemPrompt: 'You are a bot.' });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.system).toContain('You are a bot.');
        // Messages array should NOT contain a system role entry
        expect(body.messages.every(m => m.role !== 'system')).toBe(true);
    });

    it('strips markdown code fences from response', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ content: [{ text: '```json\n{"k":1}\n```' }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const result = await provider.generate({ prompt: 'json' });
        expect(result.text).toBe('{"k":1}');
    });

    it('with schema: adds JSON instruction to system prompt and returns parsed', async () => {
        const payload = { answer: 42 };
        const mockFetch = vi.fn(() =>
            jsonResponse({ content: [{ text: JSON.stringify(payload) }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        const schema = { type: 'object', properties: { answer: { type: 'number' } } };
        const result = await provider.generate({ prompt: 'give json', schema });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        // System prompt should include JSON instruction
        expect(body.system).toMatch(/JSON/);
        expect(result.parsed).toEqual(payload);
    });

    it('with schema: throws INVALID_RESPONSE when parse fails', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ content: [{ text: 'not json{{' }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await expect(provider.generate({ schema: { type: 'object' } }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.INVALID_RESPONSE });
    });

    it('maps 401 to AUTH error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(401, 'Invalid API key', 'authentication_error'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.AUTH, status: 401 });
    });

    it('maps 529 (Anthropic overload) to OVERLOAD error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(529, 'Overloaded', 'overloaded_error'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.OVERLOAD, status: 529 });
    });

    it('maps 429 to QUOTA error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(429, 'Rate limit exceeded', 'rate_limit_error'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.QUOTA });
    });

    it('maps overloaded_error type to OVERLOAD even at unexpected status', async () => {
        vi.stubGlobal('fetch', () => errorResponse(503, 'Service overloaded', 'overloaded_error'));
        await expect(provider.generate({ prompt: 'test' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.OVERLOAD });
    });

    it('sends parts as multi-part content blocks in user message', async () => {
        const mockFetch = vi.fn(() =>
            jsonResponse({ content: [{ text: 'ok' }] })
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
            jsonResponse({ content: [{ text: 'ok' }] })
        );
        vi.stubGlobal('fetch', mockFetch);

        await provider.generate({ prompt: 'test', modelOverride: 'claude-override' });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.model).toBe('claude-override');
    });
});

// ---------------------------------------------------------------------------
// embed()
// ---------------------------------------------------------------------------

describe('AnthropicProvider.embed()', () => {
    it('throws AIError with NOT_FOUND code', async () => {
        await expect(provider.embed('some text'))
            .rejects.toMatchObject({
                code: AI_ERROR_CODE.NOT_FOUND,
            });
    });

    it('error message mentions configure a separate embedding provider', async () => {
        try {
            await provider.embed('some text');
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
// generateStream()
// ---------------------------------------------------------------------------

describe('AnthropicProvider.generateStream()', () => {
    it('yields text chunks from content_block_delta events', async () => {
        vi.stubGlobal('fetch', () => anthropicSseResponse(['Hello', ', ', 'world!']));

        const chunks = [];
        for await (const chunk of provider.generateStream({ prompt: 'stream me' })) {
            chunks.push(chunk);
        }

        expect(chunks).toEqual(['Hello', ', ', 'world!']);
    });

    it('sends stream: true in request body', async () => {
        const mockFetch = vi.fn(() => anthropicSseResponse([]));
        vi.stubGlobal('fetch', mockFetch);

        for await (const _ of provider.generateStream({ prompt: 'test' })) { /* drain */ }

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.stream).toBe(true);
    });

    it('maps 401 response to AUTH error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(401, 'Unauthorized', 'authentication_error'));
        const gen = provider.generateStream({ prompt: 'test' });
        await expect(gen.next()).rejects.toMatchObject({ code: AI_ERROR_CODE.AUTH });
    });

    it('maps 529 response to OVERLOAD error', async () => {
        vi.stubGlobal('fetch', () => errorResponse(529, 'Overloaded', 'overloaded_error'));
        const gen = provider.generateStream({ prompt: 'test' });
        await expect(gen.next()).rejects.toMatchObject({ code: AI_ERROR_CODE.OVERLOAD });
    });
});
