/*
 * useRepos — two regressions from the 2026-07-17 audit:
 *
 * 1) performAction/archiveRepos/deleteRepos/createRepo were plain async
 *    functions redeclared on every render, which invalidated any caller
 *    memoized on their identity (e.g. useGitHub's withOrgRefresh wrappers,
 *    and ultimately App.jsx's sidebarProps useMemo). They're now wrapped
 *    in useCallback.
 * 2) A standalone mock-init effect (page hardcoded to 1) ran alongside the
 *    page-aware mock effect, redundantly re-generating page-1 mock data
 *    even when the URL requested a different page. It's been deleted; the
 *    page-aware effect is now the single source of truth for mock init.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// .env.test defaults VITE_MOCK_MODE=true; the first describe block below
// exercises the real API mutation callbacks, so force the real-fetch branch
// here. The mock-mode describe block re-stubs 'true' explicitly per test.
vi.stubEnv('VITE_MOCK_MODE', 'false')

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

vi.mock('../../src/__mocks__/mockRepos.js', async () => {
    const actual = await vi.importActual('../../src/__mocks__/mockRepos.js')
    return { ...actual, generateMockRepos: vi.fn(actual.generateMockRepos) }
})

const { useRepos } = await import('../../src/hooks/useRepos')

describe('useRepos — memoized mutation callbacks', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/')
    })
    afterEach(() => {
        window.history.replaceState(null, '', '/')
    })

    it('performAction/archiveRepos/deleteRepos/createRepo keep stable identity across re-renders when page/perPage/user are unchanged', async () => {
        const user = { login: 'dev-user' }
        const { result, rerender } = renderHook(() => useRepos(user))

        await waitFor(() => expect(result.current.loading).toBe(false))

        const first = {
            performAction: result.current.performAction,
            archiveRepos: result.current.archiveRepos,
            deleteRepos: result.current.deleteRepos,
            createRepo: result.current.createRepo,
        }

        rerender()

        expect(result.current.performAction).toBe(first.performAction)
        expect(result.current.archiveRepos).toBe(first.archiveRepos)
        expect(result.current.deleteRepos).toBe(first.deleteRepos)
        expect(result.current.createRepo).toBe(first.createRepo)
    })

    it('performAction identity changes once page actually changes', async () => {
        const user = { login: 'dev-user' }
        const { result } = renderHook(() => useRepos(user))
        await waitFor(() => expect(result.current.loading).toBe(false))

        const beforeFn = result.current.performAction

        result.current.setPage(2)

        await waitFor(() => expect(result.current.page).toBe(2))
        await waitFor(() => expect(result.current.performAction).not.toBe(beforeFn))
    })
})

describe('useRepos — mock-mode init respects the URL page exactly once', () => {
    afterEach(() => {
        vi.stubEnv('VITE_MOCK_MODE', 'false')
        window.history.replaceState(null, '', '/')
    })

    it('generates mock repos for the requested page a single time on mount (no redundant page-1 init)', async () => {
        vi.stubEnv('VITE_MOCK_MODE', 'true')
        vi.resetModules()

        const { generateMockRepos } = await import('../../src/__mocks__/mockRepos.js')
        generateMockRepos.mockClear()

        window.history.replaceState(null, '', '/?page=3')
        const { useRepos: useReposMocked } = await import('../../src/hooks/useRepos')
        const { result } = renderHook(() => useReposMocked(null))

        await waitFor(() => expect(result.current.repos.length).toBeGreaterThan(0))

        // Page 3 (perPage 30) starts at repo id 61 — proves the mock data
        // reflects the requested page, not a transient page-1 default.
        expect(result.current.repos[0].id).toBe(61)
        expect(generateMockRepos).toHaveBeenCalledTimes(1)
        expect(generateMockRepos).toHaveBeenCalledWith(3, 30)
    })
})
