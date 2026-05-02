/*
 * Pagination URL persistence — `?page=N` is read on mount, written on
 * setPage, and tracked across browser back/forward. This makes the
 * repos list bookmarkable / shareable instead of resetting to page 1
 * on every refresh.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// useRepos is fetched via useGitHub. We test the hook directly, mocking
// out only the network layer (no auto-fetch on mount unless user is set).
vi.mock('../../src/utils/api', async () => {
    const actual = await vi.importActual('../../src/utils/api')
    return {
        ...actual,
        fetchWithRetry: vi.fn(async () => ({
            ok: true,
            headers: { get: () => null },
            json: async () => ({ repos: [], page: 1, totalPages: 1 }),
        })),
    }
})

vi.mock('../../src/utils/repoMutations', () => ({
    archiveRepos: vi.fn(),
    deleteRepos: vi.fn(),
    performAction: vi.fn(),
}))

const { useRepos } = await import('../../src/hooks/useRepos')

describe('useRepos pagination URL persistence', () => {
    beforeEach(() => {
        // Reset URL before each test.
        window.history.replaceState(null, '', '/')
    })
    afterEach(() => {
        window.history.replaceState(null, '', '/')
    })

    it('initial page reads from `?page=` query param', () => {
        window.history.replaceState(null, '', '/?page=3')
        const { result } = renderHook(() => useRepos(null))
        expect(result.current.page).toBe(3)
    })

    it('initial page defaults to 1 when query param is missing', () => {
        const { result } = renderHook(() => useRepos(null))
        expect(result.current.page).toBe(1)
    })

    it('setPage(N) writes `?page=N` into the URL', () => {
        const { result } = renderHook(() => useRepos(null))
        act(() => result.current.setPage(4))
        expect(result.current.page).toBe(4)
        const url = new URL(window.location.href)
        expect(url.searchParams.get('page')).toBe('4')
    })

    it('setPage(1) removes the `page` query param (clean URL on first page)', () => {
        window.history.replaceState(null, '', '/?page=5')
        const { result } = renderHook(() => useRepos(null))
        act(() => result.current.setPage(1))
        expect(result.current.page).toBe(1)
        expect(new URL(window.location.href).searchParams.has('page')).toBe(false)
    })

    it('popstate (browser back/forward) re-reads the URL into state', () => {
        const { result } = renderHook(() => useRepos(null))
        // Simulate back-button to a previously-bookmarked /?page=2.
        window.history.replaceState(null, '', '/?page=2')
        act(() => {
            window.dispatchEvent(new PopStateEvent('popstate'))
        })
        expect(result.current.page).toBe(2)
    })

    it('ignores invalid `?page=` values and falls back to 1', () => {
        window.history.replaceState(null, '', '/?page=abc')
        const { result } = renderHook(() => useRepos(null))
        expect(result.current.page).toBe(1)
    })
})
