/*
 * Quota-gate contract for src/api/aiFetch.js
 *
 * The first 429+QUOTA_EXCEEDED response should "close the gate": subsequent
 * aiFetch calls inside the TTL must throw AIQuotaExceededError WITHOUT
 * touching the network. This is what stops AttentionFeed and similar
 * fan-out surfaces from spamming the devtools console with 429s.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

vi.mock('../../src/config', () => ({ API_BASE: '', MOCK_MODE: false }))
vi.mock('../../src/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'csrf-stub'),
}))
vi.mock('../../src/api/aiStatus', () => ({
    getAIStatus: vi.fn(async () => ({ configured: true, keyHealth: 'ok' })),
}))

const {
    aiFetch,
    AIQuotaExceededError,
    getAIQuotaState,
    clearAIQuotaState,
    subscribeAIQuotaState,
} = await import('../../src/api/aiFetch')

const originalFetch = global.fetch

beforeEach(() => {
    vi.clearAllMocks()
    clearAIQuotaState()
})

afterEach(() => {
    global.fetch = originalFetch
})

function jsonResponse(body, status = 200) {
    return {
        status,
        ok: status >= 200 && status < 300,
        clone() { return jsonResponse(body, status) },
        json: async () => body,
    }
}

describe('aiFetch quota gate', () => {
    it('throws AIQuotaExceededError on a 429 with QUOTA_EXCEEDED code', async () => {
        global.fetch = vi.fn(async () => jsonResponse({
            error: 'usage_limit_exceeded',
            code: 'QUOTA_EXCEEDED',
            feature: 'ai_queries',
            limit: 50,
            used: 50,
            resetAt: new Date(Date.now() + 60_000).toISOString(),
        }, 429))

        await expect(aiFetch('/api/ai/x', { method: 'POST' }))
            .rejects.toBeInstanceOf(AIQuotaExceededError)

        const state = getAIQuotaState()
        expect(state).toBeTruthy()
        expect(state.feature).toBe('ai_queries')
        expect(state.limit).toBe(50)
        expect(state.used).toBe(50)
    })

    it('pre-empts subsequent calls within the gate window without hitting the network', async () => {
        // First call: real 429 from the server.
        const fetchMock = vi.fn(async () => jsonResponse({
            error: 'usage_limit_exceeded',
            code: 'QUOTA_EXCEEDED',
            feature: 'ai_queries',
            limit: 50,
            used: 50,
            resetAt: new Date(Date.now() + 60_000).toISOString(),
        }, 429))
        global.fetch = fetchMock

        await expect(aiFetch('/api/ai/a', { method: 'POST' })).rejects.toBeInstanceOf(AIQuotaExceededError)
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // Second call: gate is closed → throws WITHOUT firing fetch.
        await expect(aiFetch('/api/ai/b', { method: 'POST' })).rejects.toBeInstanceOf(AIQuotaExceededError)
        expect(fetchMock).toHaveBeenCalledTimes(1) // unchanged
    })

    it('clears the gate after a successful call (server flipped state)', async () => {
        // Pre-populate the gate.
        global.fetch = vi.fn(async () => jsonResponse({
            error: 'usage_limit_exceeded',
            code: 'QUOTA_EXCEEDED',
            limit: 1, used: 1,
        }, 429))
        await expect(aiFetch('/api/ai/x', { method: 'POST' })).rejects.toBeTruthy()
        expect(getAIQuotaState()).toBeTruthy()

        // Force-clear (simulates upgrade or manual retry button) and then
        // serve a real OK response — gate should remain open afterwards.
        clearAIQuotaState()
        global.fetch = vi.fn(async () => jsonResponse({ data: 'fine' }, 200))
        const res = await aiFetch('/api/ai/y', { method: 'POST' })
        expect(res.status).toBe(200)
        expect(getAIQuotaState()).toBeNull()
    })

    it('does NOT close the gate on a bare 429 without QUOTA_EXCEEDED', async () => {
        // e.g. /test endpoint cooldown ratelimiter — transient, not a quota.
        global.fetch = vi.fn(async () => jsonResponse({
            error: 'Too many test requests. Wait a moment before testing again.',
        }, 429))
        const res = await aiFetch('/api/ai/test', { method: 'POST' })
        expect(res.status).toBe(429)
        expect(getAIQuotaState()).toBeNull()
    })

    it('notifies subscribers when the gate state transitions', async () => {
        const listener = vi.fn()
        const unsubscribe = subscribeAIQuotaState(listener)

        global.fetch = vi.fn(async () => jsonResponse({
            error: 'usage_limit_exceeded',
            code: 'QUOTA_EXCEEDED',
            limit: 10, used: 10,
        }, 429))

        await expect(aiFetch('/api/ai/x', { method: 'POST' })).rejects.toBeTruthy()
        expect(listener).toHaveBeenCalledTimes(1)

        clearAIQuotaState()
        expect(listener).toHaveBeenCalledTimes(2)

        unsubscribe()
        clearAIQuotaState() // listener already detached → still 2
        expect(listener).toHaveBeenCalledTimes(2)
    })
})
