import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const mockApi = {
    fetchTrackedRepos: vi.fn(),
    mutateTrackedRepo: vi.fn(),
    bulkMutateTrackedRepos: vi.fn(),
    fetchPrefs: vi.fn(),
    patchPrefs: vi.fn(),
    postDiscover: vi.fn(),
    postUndo: vi.fn(),
    postPing: vi.fn(),
    searchRepos: vi.fn(),
}
vi.mock('../../src/api/workBoardTracking', () => mockApi)

const { TrackedReposProvider } = await import('../../src/contexts/TrackedReposContext')
const { useTrackedRepos } = await import('../../src/hooks/useTrackedRepos')

function wrapper({ children }) {
    return <TrackedReposProvider>{children}</TrackedReposProvider>
}

beforeEach(() => {
    vi.stubEnv('VITE_MOCK_MODE', '')
    for (const k of Object.keys(mockApi)) mockApi[k].mockReset()
    mockApi.postPing.mockResolvedValue({ prefs: { discovery_window_days: 60 }, discovery_in_flight: false })
    mockApi.fetchTrackedRepos.mockResolvedValue({ items: [], total: 0, countsBySignal: {} })
    mockApi.fetchPrefs.mockResolvedValue({ discovery_window_days: 60, max_auto_repos: 50 })
})

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('useTrackedRepos', () => {
    it('fetches ping + repos + prefs on mount', async () => {
        renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => {
            expect(mockApi.postPing).toHaveBeenCalled()
            expect(mockApi.fetchTrackedRepos).toHaveBeenCalled()
            expect(mockApi.fetchPrefs).toHaveBeenCalled()
        })
    })

    it('exposes repos + prefs + isLoading flags', async () => {
        mockApi.fetchTrackedRepos.mockResolvedValue({
            items: [{ repo_full_name: 'a/b', is_pinned: 0, is_muted: 0, source_signal: 'owned' }],
            total: 1,
            countsBySignal: { owned: 1 },
        })
        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.repos).toHaveLength(1)
        expect(result.current.repos[0].repo_full_name).toBe('a/b')
    })

    it('pin optimistically updates state before server responds', async () => {
        mockApi.fetchTrackedRepos.mockResolvedValue({
            items: [{ repo_full_name: 'a/b', is_pinned: 0, is_muted: 0, source_signal: 'owned' }],
            total: 1,
            countsBySignal: { owned: 1 },
        })
        let resolveMutate
        mockApi.mutateTrackedRepo.mockReturnValue(new Promise(r => { resolveMutate = r }))

        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        act(() => { result.current.pin('a/b') })
        expect(result.current.repos.find(r => r.repo_full_name === 'a/b').is_pinned).toBe(1)

        resolveMutate({ operation_id: 'op-1', new_state: { is_pinned: 1, is_muted: 0 } })
        await waitFor(() => expect(result.current.repos.find(r => r.repo_full_name === 'a/b').is_pinned).toBe(1))
    })

    it('pin rolls back on server error', async () => {
        mockApi.fetchTrackedRepos.mockResolvedValue({
            items: [{ repo_full_name: 'a/b', is_pinned: 0, is_muted: 0, source_signal: 'owned' }],
            total: 1,
            countsBySignal: { owned: 1 },
        })
        mockApi.mutateTrackedRepo.mockRejectedValue(new Error('boom'))

        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        await act(async () => {
            await result.current.pin('a/b').catch(() => {})
        })
        expect(result.current.repos.find(r => r.repo_full_name === 'a/b').is_pinned).toBe(0)
    })

    it('discover() sets isRefreshing and re-fetches list', async () => {
        mockApi.postDiscover.mockResolvedValue({ discovered: 3, added: 3, removed: 0 })
        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        act(() => { result.current.discover() })
        expect(result.current.isRefreshing).toBe(true)

        await waitFor(() => expect(result.current.isRefreshing).toBe(false))
        expect(mockApi.postDiscover).toHaveBeenCalled()
        expect(mockApi.fetchTrackedRepos).toHaveBeenCalledTimes(2)
    })

    it('bulkUpdate and undo are exposed', async () => {
        mockApi.bulkMutateTrackedRepos.mockResolvedValue({ operation_id: 'op-b', updated: 2, skipped: [] })
        mockApi.postUndo.mockResolvedValue({ reverted: true })

        const { result } = renderHook(() => useTrackedRepos(), { wrapper })
        await waitFor(() => expect(result.current.isLoading).toBe(false))

        await act(async () => { await result.current.bulkUpdate(['a/b', 'c/d'], 'mute') })
        expect(mockApi.bulkMutateTrackedRepos).toHaveBeenCalledWith(['a/b', 'c/d'], 'mute')

        await act(async () => { await result.current.undo('op-b') })
        expect(mockApi.postUndo).toHaveBeenCalledWith('op-b')
    })

    it('throws useful error when used outside provider', () => {
        expect(() => renderHook(() => useTrackedRepos())).toThrow(/TrackedReposProvider/i)
    })
})
