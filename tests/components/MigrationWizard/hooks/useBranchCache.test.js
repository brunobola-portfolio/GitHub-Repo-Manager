import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/utils/api', () => ({ getCsrfToken: vi.fn().mockResolvedValue('tok') }))
vi.mock('@/utils/azureRequestPayload', () => ({ azureCredPayload: () => ({}) }))

const { useBranchCache } = await import('@/components/MigrationWizard/hooks/useBranchCache')

const SRC = { org: 'o', project: 'p' }

describe('useBranchCache', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ branches: ['main', 'dev'] }) })
  })

  it('starts with empty maps', () => {
    const { result } = renderHook(() => useBranchCache(SRC))
    expect(result.current.expandedBranches).toEqual({})
    expect(result.current.branchCache).toEqual({})
    expect(result.current.loadingBranches).toEqual({})
  })

  it('expands a repo and caches its fetched branches', async () => {
    const { result } = renderHook(() => useBranchCache(SRC))
    await act(async () => { await result.current.toggleBranchExpand({ id: 'r1', name: 'repo1' }) })
    expect(result.current.expandedBranches.r1).toBe(true)
    expect(result.current.branchCache.r1).toEqual(['main', 'dev'])
    expect(result.current.loadingBranches.r1).toBe(false)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('collapses without refetching and re-expands from cache (no second fetch)', async () => {
    const { result } = renderHook(() => useBranchCache(SRC))
    await act(async () => { await result.current.toggleBranchExpand({ id: 'r1', name: 'repo1' }) })
    await act(async () => { await result.current.toggleBranchExpand({ id: 'r1', name: 'repo1' }) }) // collapse
    expect(result.current.expandedBranches.r1).toBe(false)
    await act(async () => { await result.current.toggleBranchExpand({ id: 'r1', name: 'repo1' }) }) // re-expand
    expect(result.current.expandedBranches.r1).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1) // served from cache
  })

  it('keys by name when the repo has no id', async () => {
    const { result } = renderHook(() => useBranchCache(SRC))
    await act(async () => { await result.current.toggleBranchExpand({ name: 'noid' }) })
    expect(result.current.expandedBranches.noid).toBe(true)
  })
})
