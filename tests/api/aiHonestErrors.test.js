/*
 * Honest-error contract for src/api/ai.js — when AI is unconfigured the
 * client returns a `aiConfigured: false` placeholder ("Connect AI..."),
 * but when the user IS configured and the provider just failed at runtime
 * (503 from server with body code 'ai_overload' / 'AI_OVERLOADED'), the
 * client previously returned the same shape — visually indistinguishable
 * from "you never set it up". This pinned a different note + flag so the
 * UI can render "AI provider is temporarily unavailable" instead of
 * misleading users who already configured AI.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const { getAIStatusMock } = vi.hoisted(() => ({
    getAIStatusMock: vi.fn(async () => ({ configured: true })),
}))

// .env.test sets VITE_MOCK_MODE=true so the aiApi short-circuits to fixtures.
// These tests exercise the real network branches, so flip it off for the
// duration of the file. vi.stubEnv works on import.meta.env in Vitest 3+.
vi.stubEnv('VITE_MOCK_MODE', 'false')

vi.mock('../../src/config', () => ({ API_BASE: '', MOCK_MODE: false }))
vi.mock('../../src/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'csrf-stub'),
}))

vi.mock('../../src/api/aiStatus', () => ({
    getAIStatus: getAIStatusMock,
}))

const { aiApi } = await import('../../src/api/ai')

const originalFetch = global.fetch

beforeEach(() => {
    vi.clearAllMocks()
    getAIStatusMock.mockResolvedValue({ configured: true })
})

afterEach(() => {
    global.fetch = originalFetch
})

describe('aiApi.indexRepo — honest 503 differentiation', () => {
    it('returns aiConfigured:false when getAIStatus reports unconfigured', async () => {
        getAIStatusMock.mockResolvedValueOnce({ configured: false })
        const out = await aiApi.indexRepo({ name: 'r', language: 'TS' })
        expect(out.aiConfigured).toBe(false)
        expect(out.analysis.summary).toMatch(/Connect an AI provider/)
    })

    it('returns aiConfigured:true + runtimeUnavailable:true when configured but server returns 503', async () => {
        global.fetch = vi.fn(async () => ({
            status: 503,
            ok: false,
            json: async () => ({ error: 'overloaded', code: 'ai_overload' }),
        }))
        const out = await aiApi.indexRepo({ name: 'r', language: 'TS' })
        expect(out.aiConfigured).toBe(true)
        expect(out.runtimeUnavailable).toBe(true)
        // The placeholder summary should NOT use the unconfigured-AI message —
        // user already configured AI, the provider just failed.
        expect(out.analysis.summary).not.toMatch(/Connect an AI provider/)
        expect(out.analysis.summary).toMatch(/temporarily unavailable|try again/i)
    })
})

describe('aiApi.search — honest 503 differentiation', () => {
    it('returns runtimeUnavailable note when configured but server 503', async () => {
        global.fetch = vi.fn(async () => ({
            status: 503,
            ok: false,
            json: async () => ({ error: 'overloaded', code: 'ai_overload' }),
        }))
        const out = await aiApi.search('react hooks')
        expect(out.aiConfigured).toBe(true)
        expect(out.runtimeUnavailable).toBe(true)
        expect(out.note).toMatch(/temporarily unavailable|try again/i)
    })
})

describe('aiApi.getQualityReport — honest 503 differentiation', () => {
    it('runtime 503 surfaces a different note from unconfigured', async () => {
        global.fetch = vi.fn(async () => ({
            status: 503,
            ok: false,
            json: async () => ({ error: 'overloaded', code: 'ai_overload' }),
        }))
        const out = await aiApi.getQualityReport({ full_name: 'a/b' })
        expect(out.aiConfigured).toBe(true)
        expect(out.runtimeUnavailable).toBe(true)
        expect(out.report.summary).toMatch(/temporarily unavailable|try again/i)
    })
})

describe('aiApi.enhanceReadme + batchIndex — honest 503 differentiation', () => {
    it('enhanceReadme runtime 503 returns runtimeUnavailable shape', async () => {
        global.fetch = vi.fn(async () => ({
            status: 503,
            ok: false,
            json: async () => ({ error: 'overloaded', code: 'ai_overload' }),
        }))
        const out = await aiApi.enhanceReadme({ name: 'r' })
        expect(out.aiConfigured).toBe(true)
        expect(out.runtimeUnavailable).toBe(true)
        expect(out.note).toMatch(/temporarily unavailable|try again/i)
    })

    it('batchIndex runtime 503 returns runtimeUnavailable shape', async () => {
        global.fetch = vi.fn(async () => ({
            status: 503,
            ok: false,
            json: async () => ({ error: 'overloaded', code: 'ai_overload' }),
        }))
        const out = await aiApi.batchIndex([{ full_name: 'a/b' }])
        expect(out.aiConfigured).toBe(true)
        expect(out.runtimeUnavailable).toBe(true)
        expect(out.note).toMatch(/temporarily unavailable|try again/i)
    })
})
