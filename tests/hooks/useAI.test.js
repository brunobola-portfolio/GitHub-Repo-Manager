import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Stub CSRF + session helpers so the test fetch queue isn't consumed by auth.
vi.mock('../../src/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, getCsrfToken: vi.fn(async () => 'csrf-test-token'), isSessionExpired: () => false }
})
vi.mock('../../src/config', () => ({ MOCK_MODE: false, API_BASE: '/api' }))

import { useAI } from '../../src/hooks/useAI'

function sseResponse(events) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
        start(controller) {
            for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            controller.close()
        },
    })
    return { ok: true, status: 200, body: stream }
}

describe('useAI().askAIStream', () => {
    beforeEach(() => { globalThis.fetch = vi.fn() })
    afterEach(() => { vi.restoreAllMocks() })

    it('POSTs to /ai/chat?stream=true, accumulates deltas via onDelta, resolves { reply, actions }', async () => {
        globalThis.fetch.mockResolvedValue(sseResponse([
            { text: 'Hel' },
            { text: 'lo there' },
            { done: true, full: { reply: 'Hello there', actions: [{ type: 'open_settings', label: 'Settings' }] } },
        ]))
        const { result } = renderHook(() => useAI())

        const deltas = []
        const out = await result.current.askAIStream('hi', { user: 'alice' }, { onDelta: (t) => deltas.push(t) })

        // URL carries the stream flag
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/ai/chat?stream=true', expect.objectContaining({ method: 'POST' }))
        // onDelta received the ACCUMULATED reply as it grew
        expect(deltas).toEqual(['Hel', 'Hello there'])
        // resolves the parsed envelope from the done event
        expect(out).toEqual({ reply: 'Hello there', actions: [{ type: 'open_settings', label: 'Settings' }] })
    })

    it('throws a typed error preserving the machine code on a non-200 (quota)', async () => {
        globalThis.fetch.mockResolvedValue({
            ok: false,
            status: 429,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve({ code: 'QUOTA_EXCEEDED', message: 'AI query limit reached.' }),
            body: null,
        })
        const { result } = renderHook(() => useAI())

        await expect(result.current.askAIStream('hi', {})).rejects.toMatchObject({
            code: 'QUOTA_EXCEEDED',
            status: 429,
        })
    })

    it('surfaces a mid-stream SSE error frame as a typed error', async () => {
        globalThis.fetch.mockResolvedValue(sseResponse([
            { text: 'partial' },
            { error: true, message: 'provider blew up', code: 'AI_OVERLOADED' },
        ]))
        const { result } = renderHook(() => useAI())

        await expect(result.current.askAIStream('hi', {})).rejects.toMatchObject({ code: 'AI_OVERLOADED' })
    })

    it('returns the partial reply (no throw) when the request is aborted', async () => {
        globalThis.fetch.mockImplementation(() => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            return Promise.reject(err)
        })
        const { result } = renderHook(() => useAI())

        const out = await result.current.askAIStream('hi', {}, {})
        expect(out).toMatchObject({ aborted: true })
    })
})
