/*
 * FE-16 — src/api/ai.js and src/api/aiFetch.js are two client contracts over
 * ONE quota gate. A 429 QUOTA_EXCEEDED raised on the placeholder contract
 * (Diagram Generator, README Studio, quality report, batch index) must close
 * the same gate the typed-throw contract reads, or every sibling AI surface
 * keeps hammering a server that already said no.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Exercise the real-fetch branch: .env.test pins VITE_MOCK_MODE=true, which
// would short-circuit aiApi.search into the mock catalogue.
vi.stubEnv('VITE_MOCK_MODE', 'false')

vi.mock('../../src/config', () => ({ API_BASE: '', MOCK_MODE: false }))
vi.mock('../../src/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'csrf-stub'),
}))
vi.mock('../../src/api/aiStatus', () => ({
    getAIStatus: vi.fn(async () => ({ configured: true, keyHealth: 'ok' })),
}))

const { aiApi } = await import('../../src/api/ai')
const { getAIQuotaState, clearAIQuotaState } = await import('../../src/api/aiFetch')

const originalFetch = global.fetch

function jsonResponse(body, status = 200) {
    return {
        status,
        ok: status >= 200 && status < 300,
        clone() { return jsonResponse(body, status) },
        json: async () => body,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    clearAIQuotaState()
})

afterEach(() => {
    global.fetch = originalFetch
    clearAIQuotaState()
})

describe('api/ai.js 429 handling arms the shared quota gate', () => {
    it('records the gate for the feature named in a QUOTA_EXCEEDED body', async () => {
        global.fetch = vi.fn(async () => jsonResponse({
            code: 'QUOTA_EXCEEDED',
            error: 'AI query limit exceeded',
            feature: 'ai_queries',
            limit: 50,
            used: 50,
        }, 429))

        await expect(aiApi.search('anything')).rejects.toMatchObject({ status: 429, tierError: true })

        const state = getAIQuotaState('ai_queries')
        expect(state).toBeTruthy()
        expect(state.limit).toBe(50)
        expect(state.used).toBe(50)
    })

    it('leaves the gate open for a bare rate-limit 429 (no QUOTA_EXCEEDED code)', async () => {
        global.fetch = vi.fn(async () => jsonResponse({
            error: 'Too many requests',
        }, 429))

        await expect(aiApi.search('anything')).rejects.toMatchObject({ status: 429 })

        expect(getAIQuotaState('ai_queries')).toBeNull()
        expect(getAIQuotaState()).toBeNull()
    })
})
