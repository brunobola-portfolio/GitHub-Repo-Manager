// @vitest-environment node
/**
 * Tests for server/lib/providers/anthropic.js (AnthropicProvider)
 *
 * Covers:
 *  I6 — SSE stream abort mid-read throws AIError(CANCELED)
 *  I7 — parts array passed as native multi-part content blocks (not joined string)
 *  I14 — getModelName() public getter
 */

import { describe, it, expect, vi } from 'vitest'
import { AnthropicProvider } from '../lib/providers/anthropic.js'
import { AIError, AI_ERROR_CODE } from '../lib/ai-provider.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeSSE(lines) {
    return new TextEncoder().encode(lines.join('\n') + '\n')
}

// ---------------------------------------------------------------------------
// I14 — getModelName() getter
// ---------------------------------------------------------------------------

describe('AnthropicProvider.getModelName()', () => {
    it('returns the model name set in the constructor', () => {
        const p = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-opus-20240229' })
        expect(p.getModelName()).toBe('claude-3-opus-20240229')
    })

    it('defaults to claude-sonnet-4-6 when no model is specified', () => {
        const p = new AnthropicProvider({ apiKey: 'sk-ant-test1234' })
        expect(p.getModelName()).toBe('claude-sonnet-4-6')
    })
})

// ---------------------------------------------------------------------------
// I7 — parts array → multi-part content blocks
// ---------------------------------------------------------------------------

describe('AnthropicProvider.generate() — parts multi-part content (I7)', () => {
    async function runGenerateWithParts(parts) {
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' })
        let capturedBody = null

        provider._post = vi.fn(async (path, body) => {
            capturedBody = body
            return {
                content: [{ text: 'ok' }],
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

        // Anthropic messages shape: messages[0].content must be an array
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
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' })
        let capturedBody = null

        provider._post = vi.fn(async (path, body) => {
            capturedBody = body
            return { content: [{ text: 'ok' }] }
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

describe('AnthropicProvider.generateStream() — abort handling (I6)', () => {
    it('throws AIError(CANCELED) when AbortError is raised during reader.read()', async () => {
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' })
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
                            'data: ' + JSON.stringify({
                                type: 'content_block_delta',
                                delta: { type: 'text_delta', text: 'chunk1' },
                            }),
                        ]),
                    }
                }
                // Second read: throw AbortError
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
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' })
        const controller = new AbortController()
        controller.abort() // pre-abort

        const chunks = []

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

    it('returns usage + costUSD parsed from message_start and message_delta events', async () => {
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' })

        let readCount = 0
        const reader = {
            read: vi.fn(async () => {
                readCount++
                if (readCount === 1) {
                    return {
                        done: false,
                        value: encodeSSE([
                            'data: ' + JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 30, output_tokens: 1 } } }),
                            'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
                            'data: ' + JSON.stringify({ type: 'message_delta', usage: { output_tokens: 18 } }),
                        ]),
                    }
                }
                return { done: true, value: undefined }
            }),
            releaseLock: vi.fn(),
        }
        provider._postStream = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } })

        const iter = provider.generateStream({ prompt: 'x' })
        const first = await iter.next()
        expect(first.value).toBe('hi')
        const final = await iter.next()
        expect(final.done).toBe(true)
        expect(final.value.usage).toEqual({ inputTokens: 30, outputTokens: 18 })
        expect(typeof final.value.costUSD).toBe('number')
        expect(final.value.costUSD).toBeGreaterThan(0)
    })

    it('returns null usage/costUSD when no usage events are present in the stream', async () => {
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' })
        let readCount = 0
        const reader = {
            read: vi.fn(async () => {
                readCount++
                if (readCount === 1) {
                    return {
                        done: false,
                        value: encodeSSE([
                            'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } }),
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
        const provider = new AnthropicProvider({ apiKey: 'sk-ant-test1234', model: 'claude-3-sonnet' })
        const controller = new AbortController()

        let readCount = 0

        const reader = {
            read: vi.fn(async () => {
                readCount++
                if (readCount === 1) {
                    return {
                        done: false,
                        value: encodeSSE([
                            'data: ' + JSON.stringify({
                                type: 'content_block_delta',
                                delta: { type: 'text_delta', text: 'a' },
                            }),
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

        await expect(async () => {
            for await (const chunk of gen) {
                chunks.push(chunk)
            }
        }).rejects.toMatchObject({ code: AI_ERROR_CODE.CANCELED })

        expect(chunks).toContain('a')
    })
})
