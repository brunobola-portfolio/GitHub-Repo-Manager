// @vitest-environment node
/**
 * Tests for server/lib/providers/openai.js (OpenAIProvider)
 *
 * Covers:
 *  I6 — SSE stream abort mid-read throws AIError(CANCELED)
 *  I7 — parts array passed as native multi-part content blocks (not joined string)
 *  I14 — getModelName() public getter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAIProvider } from '../lib/providers/openai.js'
import { AIError, AI_ERROR_CODE } from '../lib/ai-provider.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock fetch that returns a streaming SSE response.
 * `chunks` is an array of raw SSE lines (or arrays of strings per read call).
 * Each element in `reads` is the bytes returned by one reader.read() call.
 */
// eslint-disable-next-line no-unused-vars -- helper retained for upcoming abort-stream tests; signature must match prod fetch
function makeFetchWithStream(reads, { abortAfter: _abortAfter = Infinity } = {}) {
    let callCount = 0

    const reader = {
        read: vi.fn(async () => {
            const idx = callCount++
            if (idx >= reads.length) return { done: true, value: undefined }
            return { done: false, value: reads[idx] }
        }),
        releaseLock: vi.fn(),
        cancel: vi.fn(),
    }

    const mockResponse = {
        ok: true,
        status: 200,
        body: { getReader: () => reader },
    }

    return {
        fetch: vi.fn().mockResolvedValue(mockResponse),
        reader,
    }
}

// Encode SSE event lines to Uint8Array
function encodeSSE(lines) {
    return new TextEncoder().encode(lines.join('\n') + '\n')
}

// ---------------------------------------------------------------------------
// I14 — getModelName() getter
// ---------------------------------------------------------------------------

describe('OpenAIProvider.getModelName()', () => {
    it('returns the model name set in the constructor', () => {
        const p = new OpenAIProvider({ apiKey: 'sk-test12345678', model: 'gpt-4o-mini' })
        expect(p.getModelName()).toBe('gpt-4o-mini')
    })

    it('defaults to gpt-5.6-luna when no model is specified', () => {
        const p = new OpenAIProvider({ apiKey: 'sk-test12345678' })
        expect(p.getModelName()).toBe('gpt-5.6-luna')
    })
})

// ---------------------------------------------------------------------------
// I7 — parts array → multi-part content blocks
// ---------------------------------------------------------------------------

describe('OpenAIProvider.generate() — parts multi-part content (I7)', () => {
    let capturedBody

    beforeEach(() => {
        capturedBody = null
    })

    async function runGenerateWithParts(parts) {
        const provider = new OpenAIProvider({ apiKey: 'sk-test12345678', model: 'gpt-4o' })

        // Intercept the _post call to capture the body
        provider._post = vi.fn(async (path, body) => {
            capturedBody = body
            return {
                choices: [{ message: { content: 'ok' } }],
            }
        })

        await provider.generate({ parts })
        return capturedBody
    }

    it('sends parts as separate text blocks in the user message content array', async () => {
        const parts = [
            { text: 'system-context' },
            { text: 'untrusted-user-input' },
        ]

        const body = await runGenerateWithParts(parts)

        // user message content must be an array, not a joined string
        const userMsg = body.messages.find(m => m.role === 'user')
        expect(Array.isArray(userMsg.content)).toBe(true)
        expect(userMsg.content).toHaveLength(2)
        expect(userMsg.content[0]).toEqual({ type: 'text', text: 'system-context' })
        expect(userMsg.content[1]).toEqual({ type: 'text', text: 'untrusted-user-input' })
    })

    it('keeps each part as a distinct block (not a joined string)', async () => {
        const parts = [
            { text: 'block-one' },
            { text: 'block-two' },
        ]

        const body = await runGenerateWithParts(parts)
        const userMsg = body.messages.find(m => m.role === 'user')

        // Must NOT be a plain string concatenation
        expect(typeof userMsg.content).not.toBe('string')
    })

    it('falls back to prompt string when parts is not provided', async () => {
        const provider = new OpenAIProvider({ apiKey: 'sk-test12345678', model: 'gpt-4o' })
        let capturedBody = null

        provider._post = vi.fn(async (path, body) => {
            capturedBody = body
            return { choices: [{ message: { content: 'ok' } }] }
        })

        await provider.generate({ prompt: 'hello world' })

        const userMsg = capturedBody.messages.find(m => m.role === 'user')
        expect(typeof userMsg.content).toBe('string')
        expect(userMsg.content).toBe('hello world')
    })
})

// ---------------------------------------------------------------------------
// I6 — SSE stream abort → AIError(CANCELED)
// ---------------------------------------------------------------------------

describe('OpenAIProvider.generateStream() — abort handling (I6)', () => {
    it('throws AIError(CANCELED) when AbortError is raised during reader.read()', async () => {
        const provider = new OpenAIProvider({ apiKey: 'sk-test12345678', model: 'gpt-4o' })
        const controller = new AbortController()

        let readCallCount = 0
        const reader = {
            read: vi.fn(async () => {
                readCallCount++
                if (readCallCount === 1) {
                    // First read: return a valid SSE chunk
                    return {
                        done: false,
                        value: encodeSSE([
                            'data: ' + JSON.stringify({ choices: [{ delta: { content: 'chunk1' } }] }),
                        ]),
                    }
                }
                // Second read: throw AbortError (as happens when signal fires)
                const err = new Error('The operation was aborted')
                err.name = 'AbortError'
                throw err
            }),
            releaseLock: vi.fn(),
        }

        provider._postStream = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            body: { getReader: () => reader },
        })

        const gen = provider.generateStream({ prompt: 'test', signal: controller.signal })

        // Collect first chunk
        const first = await gen.next()
        expect(first.value).toBe('chunk1')

        // Second iteration should throw AIError(CANCELED)
        await expect(gen.next()).rejects.toMatchObject({
            code: AI_ERROR_CODE.CANCELED,
        })

        expect(reader.releaseLock).toHaveBeenCalled()
    })

    it('stops cleanly when signal is already aborted before loop body', async () => {
        const provider = new OpenAIProvider({ apiKey: 'sk-test12345678', model: 'gpt-4o' })
        const controller = new AbortController()
        controller.abort() // pre-abort

        let chunks = []

        const reader = {
            read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
            releaseLock: vi.fn(),
        }

        provider._postStream = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            body: { getReader: () => reader },
        })

        for await (const chunk of provider.generateStream({ prompt: 'test', signal: controller.signal })) {
            chunks.push(chunk)
        }

        // Loop should exit immediately on pre-aborted signal without throwing
        expect(chunks).toHaveLength(0)
    })

    it('requests usage via stream_options and returns usage + costUSD from the final chunk', async () => {
        const provider = new OpenAIProvider({ apiKey: 'sk-test12345678', model: 'gpt-4o' })
        let capturedBody = null
        let readCount = 0
        const reader = {
            read: vi.fn(async () => {
                readCount++
                if (readCount === 1) {
                    return {
                        done: false,
                        value: encodeSSE([
                            'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }),
                            'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 12 } }),
                            'data: [DONE]',
                        ]),
                    }
                }
                return { done: true, value: undefined }
            }),
            releaseLock: vi.fn(),
        }
        provider._postStream = vi.fn(async (path, body) => {
            capturedBody = body
            return { ok: true, status: 200, body: { getReader: () => reader } }
        })

        const iter = provider.generateStream({ prompt: 'x' })
        const first = await iter.next()
        expect(first.value).toBe('hi')
        const final = await iter.next()
        expect(final.done).toBe(true)
        expect(capturedBody.stream_options).toEqual({ include_usage: true })
        expect(final.value.usage).toEqual({ inputTokens: 40, outputTokens: 12 })
        expect(typeof final.value.costUSD).toBe('number')
        expect(final.value.costUSD).toBeGreaterThan(0)
    })

    it('returns null usage/costUSD when no usage chunk is present', async () => {
        const provider = new OpenAIProvider({ apiKey: 'sk-test12345678', model: 'gpt-4o' })
        let readCount = 0
        const reader = {
            read: vi.fn(async () => {
                readCount++
                if (readCount === 1) {
                    return {
                        done: false,
                        value: encodeSSE([
                            'data: ' + JSON.stringify({ choices: [{ delta: { content: 'a' } }] }),
                            'data: [DONE]',
                        ]),
                    }
                }
                return { done: true, value: undefined }
            }),
            releaseLock: vi.fn(),
        }
        provider._postStream = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } })

        const iter = provider.generateStream({ prompt: 'x' })
        await iter.next()
        const final = await iter.next()
        expect(final.done).toBe(true)
        expect(final.value).toEqual({ usage: null, costUSD: null })
    })

    it('throws AIError(CANCELED) when mid-stream AbortError is caught', async () => {
        const provider = new OpenAIProvider({ apiKey: 'sk-test12345678', model: 'gpt-4o' })
        const controller = new AbortController()

        let readCount = 0

        const reader = {
            read: vi.fn(async () => {
                readCount++
                if (readCount === 1) {
                    return {
                        done: false,
                        value: encodeSSE([
                            'data: ' + JSON.stringify({ choices: [{ delta: { content: 'a' } }] }),
                            'data: ' + JSON.stringify({ choices: [{ delta: { content: 'b' } }] }),
                        ]),
                    }
                }
                // Abort then throw
                controller.abort()
                const err = new Error('AbortError')
                err.name = 'AbortError'
                throw err
            }),
            releaseLock: vi.fn(),
        }

        provider._postStream = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            body: { getReader: () => reader },
        })

        const chunks = []
        const gen = provider.generateStream({ prompt: 'x', signal: controller.signal })

        // Collect chunks until error
        await expect(async () => {
            for await (const chunk of gen) {
                chunks.push(chunk)
            }
        }).rejects.toMatchObject({ code: AI_ERROR_CODE.CANCELED })

        // We should have received 'a' and 'b' before the abort
        expect(chunks).toContain('a')
    })
})
