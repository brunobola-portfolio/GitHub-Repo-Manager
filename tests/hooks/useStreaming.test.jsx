import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// useStreaming fetches a CSRF token before each POST; stub it so the test
// fetch queue isn't consumed by the auth/csrf-token request.
vi.mock('../../src/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, getCsrfToken: vi.fn(async () => 'csrf-test-token') }
})

import { useStreaming } from '../../src/hooks/useStreaming'

// --- Helper: create a mock SSE response with a ReadableStream ---
function createMockSSEResponse(events) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
        start(controller) {
            for (const event of events) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            }
            controller.close()
        }
    })
    return { ok: true, status: 200, body: stream }
}

// --- Helper: create a non-ok response ---
function createErrorResponse(status, body = {}) {
    return {
        ok: false,
        status,
        json: () => Promise.resolve(body),
        body: null,
    }
}

describe('useStreaming', () => {
    let fetchSpy

    beforeEach(() => {
        fetchSpy = vi.fn()
        globalThis.fetch = fetchSpy
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    // --- 1. Initial state ---
    it('returns correct initial state', () => {
        const { result } = renderHook(() => useStreaming())

        expect(result.current.isStreaming).toBe(false)
        expect(result.current.streamingText).toBe('')
        expect(result.current.error).toBeNull()
        expect(result.current.result).toBeNull()
        expect(result.current.retryCount).toBe(0)
        expect(typeof result.current.startStream).toBe('function')
        expect(typeof result.current.cancelStream).toBe('function')
        expect(typeof result.current.reset).toBe('function')
    })

    // --- 2. startStream makes POST with ?stream=true and parses SSE ---
    it('startStream sends POST to url?stream=true and accumulates text chunks', async () => {
        const mockResponse = createMockSSEResponse([
            { text: 'Hello ' },
            { text: 'world' },
            { done: true, full: { message: 'Hello world' } },
        ])
        fetchSpy.mockResolvedValue(mockResponse)

        const { result } = renderHook(() => useStreaming())

        let streamResult
        await act(async () => {
            streamResult = await result.current.startStream('/api/generate', { prompt: 'test' })
        })

        // Verify fetch was called with correct args
        expect(fetchSpy).toHaveBeenCalledWith(
            '/api/generate?stream=true',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-test-token' }),
                credentials: 'include',
                body: JSON.stringify({ prompt: 'test' }),
            })
        )

        // Verify final state
        expect(result.current.streamingText).toBe('Hello world')
        expect(result.current.result).toEqual({ message: 'Hello world' })
        expect(result.current.isStreaming).toBe(false)
        expect(streamResult).toEqual({ message: 'Hello world' })
    })

    it('appends & separator when URL already has query params', async () => {
        const mockResponse = createMockSSEResponse([
            { done: true, full: { ok: true } },
        ])
        fetchSpy.mockResolvedValue(mockResponse)

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/generate?model=gpt', {})
        })

        expect(fetchSpy).toHaveBeenCalledWith(
            '/api/generate?model=gpt&stream=true',
            expect.anything()
        )
    })

    // --- 3. cancelStream aborts fetch and resets streaming state ---
    it('cancelStream resets isStreaming, error, and retryCount', async () => {
        const mockResponse = createMockSSEResponse([
            { text: 'chunk' },
            { done: true, full: { ok: true } },
        ])
        fetchSpy.mockResolvedValue(mockResponse)

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        act(() => {
            result.current.cancelStream()
        })

        expect(result.current.isStreaming).toBe(false)
        expect(result.current.error).toBeNull()
        expect(result.current.retryCount).toBe(0)
    })

    // --- 4. reset clears all state ---
    it('reset clears all state back to initial values', async () => {
        const mockResponse = createMockSSEResponse([
            { text: 'data' },
            { done: true, full: { complete: true } },
        ])
        fetchSpy.mockResolvedValue(mockResponse)

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        expect(result.current.streamingText).toBe('data')
        expect(result.current.result).toEqual({ complete: true })

        act(() => {
            result.current.reset()
        })

        expect(result.current.streamingText).toBe('')
        expect(result.current.isStreaming).toBe(false)
        expect(result.current.error).toBeNull()
        expect(result.current.result).toBeNull()
        expect(result.current.retryCount).toBe(0)
    })

    // --- 5. Error handling - non-ok response sets error (no retry) ---
    it('sets error message from response body on non-ok response', async () => {
        fetchSpy.mockResolvedValue(createErrorResponse(422, { message: 'Validation failed' }))

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        expect(result.current.error).toBe('Validation failed')
        expect(result.current.isStreaming).toBe(false)
        expect(result.current.retryCount).toBe(0)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('sets fallback error when response body has no message', async () => {
        fetchSpy.mockResolvedValue(createErrorResponse(500, {}))

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        expect(result.current.error).toBe('Request failed: 500')
        expect(result.current.isStreaming).toBe(false)
    })

    it('uses error field from response body when message is absent', async () => {
        fetchSpy.mockResolvedValue(createErrorResponse(400, { error: 'Bad input' }))

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        expect(result.current.error).toBe('Bad input')
    })

    // --- 7. HTTP errors do NOT retry ---
    it('does not retry on HTTP error responses', async () => {
        fetchSpy.mockResolvedValue(createErrorResponse(403, { message: 'Forbidden' }))

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        expect(result.current.error).toBe('Forbidden')
        expect(result.current.retryCount).toBe(0)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    // --- SSE stream error event ---
    it('handles stream error events from SSE data', async () => {
        const mockResponse = createMockSSEResponse([
            { text: 'partial' },
            { error: true, message: 'AI service unavailable' },
        ])
        fetchSpy.mockResolvedValue(mockResponse)

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        expect(result.current.error).toBe('AI service unavailable')
        expect(result.current.isStreaming).toBe(false)
    })

    // --- Malformed JSON lines are silently skipped ---
    it('skips malformed JSON lines without crashing', async () => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`data: not-valid-json\n\n`))
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: 'ok' })}\n\n`))
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, full: { ok: true } })}\n\n`))
                controller.close()
            }
        })
        fetchSpy.mockResolvedValue({ ok: true, status: 200, body: stream })

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        expect(result.current.streamingText).toBe('ok')
        expect(result.current.result).toEqual({ ok: true })
    })

    // --- Lines without "data: " prefix are ignored ---
    it('ignores lines that do not start with "data: "', async () => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`event: heartbeat\n\n`))
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: 'content' })}\n\n`))
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, full: {} })}\n\n`))
                controller.close()
            }
        })
        fetchSpy.mockResolvedValue({ ok: true, status: 200, body: stream })

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        expect(result.current.streamingText).toBe('content')
    })

    // --- Network errors trigger retry ---
    it('does not retry network errors beyond maxRetries', async () => {
        // Use maxRetries: 0 to test immediate failure
        const networkError = new Error('Failed to fetch')
        fetchSpy.mockRejectedValue(networkError)

        const { result } = renderHook(() => useStreaming({ maxRetries: 0 }))

        await act(async () => {
            await result.current.startStream('/api/test', {})
        })

        expect(result.current.error).toBe('Failed to fetch')
        expect(result.current.isStreaming).toBe(false)
        expect(result.current.retryCount).toBe(0)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('AbortError does not set error state', async () => {
        const abortError = new DOMException('The operation was aborted.', 'AbortError')
        fetchSpy.mockRejectedValue(abortError)

        const { result } = renderHook(() => useStreaming())

        await act(async () => {
            const r = await result.current.startStream('/api/test', {})
            expect(r).toBeNull()
        })

        expect(result.current.error).toBeNull()
        expect(result.current.isStreaming).toBe(false)
    })
})
