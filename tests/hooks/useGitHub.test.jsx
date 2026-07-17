/*
 * useGitHub — performAction/createRepo/deleteRepos/archiveRepos are built by
 * calling withOrgRefresh(...) on the raw useRepos callbacks. Previously that
 * call happened inline on every render, producing a brand-new function
 * identity each time even after the raw callbacks themselves became
 * useCallback-stable — which kept invalidating any memoization keyed on
 * these functions (notably App.jsx's sidebarProps useMemo). They're now
 * wrapped in useMemo so identity only changes when their real dependencies
 * (withOrgRefresh, the raw callback) change.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// .env.test defaults VITE_MOCK_MODE=true, which would auto-populate a mock
// user (useAuth) and cascade into org/stats fetches — noise unrelated to
// what this test asserts. Force the real (logged-out, no-op) branch.
vi.stubEnv('VITE_MOCK_MODE', 'false')

const { useGitHub } = await import('../../src/hooks/useGitHub')

describe('useGitHub — memoized withOrgRefresh wrappers', () => {
    it('performAction/createRepo/deleteRepos/archiveRepos keep stable identity across re-renders (logged out)', () => {
        const { result, rerender } = renderHook(() => useGitHub())

        const first = {
            performAction: result.current.performAction,
            createRepo: result.current.createRepo,
            deleteRepos: result.current.deleteRepos,
            archiveRepos: result.current.archiveRepos,
        }

        rerender()

        expect(result.current.performAction).toBe(first.performAction)
        expect(result.current.createRepo).toBe(first.createRepo)
        expect(result.current.deleteRepos).toBe(first.deleteRepos)
        expect(result.current.archiveRepos).toBe(first.archiveRepos)
    })
})
