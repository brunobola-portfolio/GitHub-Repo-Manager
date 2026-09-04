/*
 * Plain-text search is client-side over the repositories on screen, so a
 * match on page two returned "No matches". loadAllPages() fetches the whole
 * account at per_page=100 and collapses pagination to a single page so the
 * filter can see everything.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// .env.test pins VITE_MOCK_MODE=true, which routes both refresh() and
// loadAllPages() to the client-side generator; this file covers the network path.
vi.stubEnv('VITE_MOCK_MODE', 'false')

const fetchWithRetry = vi.fn()

vi.mock('../../src/utils/api', async () => {
    const actual = await vi.importActual('../../src/utils/api')
    return { ...actual, fetchWithRetry: (...args) => fetchWithRetry(...args) }
})

vi.mock('../../src/utils/repoMutations', () => ({
    archiveRepos: vi.fn(),
    deleteRepos: vi.fn(),
    performAction: vi.fn(),
}))

const { useRepos } = await import('../../src/hooks/useRepos')

// safeParseJson only calls .json() when the content-type says JSON.
const page = (repos, totalPages) => ({
    ok: true,
    headers: { get: (name) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => ({ repos, page: 1, totalPages }),
    text: async () => '',
})

describe('useRepos.loadAllPages', () => {
    beforeEach(() => {
        fetchWithRetry.mockReset()
        window.history.replaceState(null, '', '/#/repos')
    })

    it('fetches every page at per_page=100 and collapses pagination to one page', async () => {
        fetchWithRetry
            .mockResolvedValueOnce(page([{ id: 1, name: 'a' }, { id: 2, name: 'b' }], 2))
            .mockResolvedValueOnce(page([{ id: 3, name: 'graphql-federation-3' }], 2))

        const { result } = renderHook(() => useRepos(null))
        await act(async () => { await result.current.loadAllPages() })

        expect(fetchWithRetry.mock.calls.map(([url]) => url)).toEqual([
            '/api/repos?page=1&per_page=100',
            '/api/repos?page=2&per_page=100',
        ])
        expect(result.current.repos.map((r) => r.name)).toEqual(['a', 'b', 'graphql-federation-3'])
        expect(result.current.totalPages).toBe(1)
        expect(result.current.page).toBe(1)
        expect(result.current.allPagesLoaded).toBe(true)
    })

    it('a later paged fetch turns allPagesLoaded back off', async () => {
        fetchWithRetry.mockResolvedValue(page([{ id: 1, name: 'a' }], 1))
        const { result } = renderHook(() => useRepos(null))
        await act(async () => { await result.current.loadAllPages() })
        expect(result.current.allPagesLoaded).toBe(true)

        await act(async () => { await result.current.refresh() })
        expect(result.current.allPagesLoaded).toBe(false)
    })

    it('surfaces a failure instead of leaving a half-loaded list', async () => {
        fetchWithRetry
            .mockResolvedValueOnce(page([{ id: 1, name: 'a' }], 3))
            .mockRejectedValueOnce(new Error('network down'))

        const { result } = renderHook(() => useRepos(null))
        await act(async () => { await result.current.loadAllPages() })

        expect(result.current.allPagesLoaded).toBe(false)
        expect(result.current.error).toBeTruthy()
    })
})
