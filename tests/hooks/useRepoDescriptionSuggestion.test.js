import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Stub CSRF fetch so tests only need to mock the AI endpoint response.
vi.mock('../../src/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'test-csrf-token'),
}))

const { useRepoDescriptionSuggestion } = await import('../../src/hooks/useRepoDescriptionSuggestion')

const baseRepo = {
    id: 'r1',
    name: 'Cacadores',
    targetName: 'Cacadores',
    language: 'C#',
    size: 12000,
    branches: 0,
    hasLfsMarker: false,
    lastCommitDate: null,
    isTfvc: true,
    tfvcPath: '$/APOS - Advanced POS/Cacadores',
}

const baseSource = { org: 'brunobola', project: 'APOS - Advanced POS' }

describe('useRepoDescriptionSuggestion', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('returns a template description when aiAvailable is false (no network call)', async () => {
        const fetchMock = vi.fn()
        globalThis.fetch = fetchMock
        const { result } = renderHook(() => useRepoDescriptionSuggestion({ aiAvailable: false }))

        let outcome
        await act(async () => {
            outcome = await result.current.suggest({ repo: baseRepo, source: baseSource })
        })

        expect(fetchMock).not.toHaveBeenCalled()
        expect(outcome.mode).toBe('template')
        expect(outcome.description).toBe('Migrated from Azure DevOps TFVC: APOS - Advanced POS/Cacadores')
        expect(outcome.quotaExceeded).toBe(false)
    })

    it('uses the AI endpoint and returns mode "ai" on success', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' }, json: async () => ({ description: 'Payment system migrated from Azure DevOps TFVC.' }),
        }))
        const { result } = renderHook(() => useRepoDescriptionSuggestion({ aiAvailable: true }))

        let outcome
        await act(async () => {
            outcome = await result.current.suggest({ repo: baseRepo, source: baseSource })
        })

        expect(globalThis.fetch).toHaveBeenCalledWith(
            '/api/ai/migration-description',
            expect.objectContaining({ method: 'POST' })
        )
        expect(outcome.mode).toBe('ai')
        expect(outcome.description).toBe('Payment system migrated from Azure DevOps TFVC.')
    })

    it('falls back to template with quotaExceeded=true on 429', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 429 }))
        const { result } = renderHook(() => useRepoDescriptionSuggestion({ aiAvailable: true }))

        let outcome
        await act(async () => {
            outcome = await result.current.suggest({ repo: baseRepo, source: baseSource })
        })

        expect(outcome.mode).toBe('template')
        expect(outcome.quotaExceeded).toBe(true)
        expect(outcome.description).toMatch(/^Migrated from Azure DevOps TFVC:/)
    })

    it('falls back silently to template on any other error', async () => {
        globalThis.fetch = vi.fn(() => Promise.reject(new Error('network')))
        const { result } = renderHook(() => useRepoDescriptionSuggestion({ aiAvailable: true }))

        let outcome
        await act(async () => {
            outcome = await result.current.suggest({ repo: baseRepo, source: baseSource })
        })

        expect(outcome.mode).toBe('template')
        expect(outcome.quotaExceeded).toBe(false)
        expect(outcome.description).toMatch(/^Migrated from Azure DevOps TFVC:/)
    })

    it('falls back to template when Gemini returns 200 with empty description', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' }, json: async () => ({ description: '   ' }),
        }))
        const { result } = renderHook(() => useRepoDescriptionSuggestion({ aiAvailable: true }))

        let outcome
        await act(async () => {
            outcome = await result.current.suggest({ repo: baseRepo, source: baseSource })
        })

        expect(outcome.mode).toBe('template')
    })

    it('sanitizes the AI response (collapses newlines, strips emoji)', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' }, json: async () => ({ description: '🚀 Hello\n\nWorld' }),
        }))
        const { result } = renderHook(() => useRepoDescriptionSuggestion({ aiAvailable: true }))

        let outcome
        await act(async () => {
            outcome = await result.current.suggest({ repo: baseRepo, source: baseSource })
        })

        expect(outcome.description).toBe('Hello World')
    })

    it('composes a git template when repo is not TFVC', async () => {
        const gitRepo = { ...baseRepo, isTfvc: false, tfvcPath: null, name: 'my-repo', targetName: 'my-repo' }
        const { result } = renderHook(() => useRepoDescriptionSuggestion({ aiAvailable: false }))

        let outcome
        await act(async () => {
            outcome = await result.current.suggest({ repo: gitRepo, source: baseSource })
        })

        expect(outcome.description).toBe('Migrated from Azure DevOps: brunobola/APOS - Advanced POS/my-repo')
    })
})
