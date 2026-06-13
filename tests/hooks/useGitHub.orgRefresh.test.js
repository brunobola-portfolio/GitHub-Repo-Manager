import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Real-time org data: useGitHub wraps every repo mutation so a successful one
// also refreshes the org "N repos" badges + dashboard stats (fetchOrgs +
// fetchStats), while a failed / throwing one does not. We mock the sub-hooks
// so we can inject spies for the raw mutations and the org refetchers.

const fetchOrgs = vi.fn().mockResolvedValue(undefined)
const fetchStats = vi.fn().mockResolvedValue(undefined)
const performActionRaw = vi.fn()
const createRepoRaw = vi.fn()
const deleteReposRaw = vi.fn()
const archiveReposRaw = vi.fn()

vi.mock('@/config', () => ({ MOCK_MODE: false }))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { login: 'octocat' }, fetchUser: vi.fn() }),
}))

vi.mock('@/hooks/useRepos', () => ({
  useRepos: () => ({
    repos: [], page: 1, perPage: 30, totalPages: 1, isPerforming: false, results: [],
    setPage: vi.fn(), refresh: vi.fn(), patchRepoLocal: vi.fn(),
    performAction: performActionRaw,
    archiveRepos: archiveReposRaw,
    deleteRepos: deleteReposRaw,
    createRepo: createRepoRaw,
    importFromAzure: vi.fn(), checkImportStatus: vi.fn(),
  }),
}))

vi.mock('@/hooks/useOrgs', () => ({
  useOrgs: () => ({
    orgs: [], selectedOrg: null, setSelectedOrg: vi.fn(), orgRepos: [], stats: {}, activity: [],
    fetchOrgs, fetchOrgRepos: vi.fn(), fetchStats, patchOrgRepoLocal: vi.fn(),
  }),
}))

vi.mock('@/hooks/useAI', () => ({
  useAI: () => ({ checkAIStatus: vi.fn(), askAI: vi.fn() }),
}))

const { useGitHub } = await import('@/hooks/useGitHub')

describe('useGitHub — real-time org refresh after mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes orgs + stats after a successful performAction (transfer/mirror/visibility)', async () => {
    performActionRaw.mockResolvedValue({ success: true })
    const { result } = renderHook(() => useGitHub())

    await act(async () => { await result.current.performAction('transfer', ['me/a'], 'org') })

    expect(performActionRaw).toHaveBeenCalledWith('transfer', ['me/a'], 'org')
    expect(fetchOrgs).toHaveBeenCalledTimes(1)
    expect(fetchStats).toHaveBeenCalledTimes(1)
  })

  it('does NOT refresh when performAction reports failure (success:false)', async () => {
    performActionRaw.mockResolvedValue({ success: false, message: 'nope' })
    const { result } = renderHook(() => useGitHub())

    await act(async () => { await result.current.performAction('transfer', [], 'org') })

    expect(fetchOrgs).not.toHaveBeenCalled()
    expect(fetchStats).not.toHaveBeenCalled()
  })

  it('refreshes after a successful createRepo and returns the original result', async () => {
    createRepoRaw.mockResolvedValue({ success: true, repo: { full_name: 'me/new' } })
    const { result } = renderHook(() => useGitHub())

    let returned
    await act(async () => { returned = await result.current.createRepo('new', { org: 'me' }) })

    expect(returned).toEqual({ success: true, repo: { full_name: 'me/new' } })
    expect(fetchOrgs).toHaveBeenCalledTimes(1)
    expect(fetchStats).toHaveBeenCalledTimes(1)
  })

  it('refreshes after deleteRepos resolves, and skips refresh when it throws', async () => {
    deleteReposRaw.mockResolvedValue({ success: true })
    const { result } = renderHook(() => useGitHub())

    await act(async () => { await result.current.deleteRepos(['me/a']) })
    expect(fetchOrgs).toHaveBeenCalledTimes(1)

    // A throwing wrapper (delete/archive reject on failure) must propagate the
    // error and NOT trigger a refresh.
    vi.clearAllMocks()
    deleteReposRaw.mockRejectedValue(new Error('boom'))
    await act(async () => {
      await expect(result.current.deleteRepos(['me/a'])).rejects.toThrow('boom')
    })
    expect(fetchOrgs).not.toHaveBeenCalled()
    expect(fetchStats).not.toHaveBeenCalled()
  })

  it('refreshes after a successful archiveRepos', async () => {
    archiveReposRaw.mockResolvedValue({ success: true })
    const { result } = renderHook(() => useGitHub())

    await act(async () => { await result.current.archiveRepos(['me/a'], true) })

    expect(fetchOrgs).toHaveBeenCalledTimes(1)
    expect(fetchStats).toHaveBeenCalledTimes(1)
  })
})
