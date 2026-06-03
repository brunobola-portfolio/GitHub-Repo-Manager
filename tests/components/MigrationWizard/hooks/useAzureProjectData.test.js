import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/utils/api', () => ({ getCsrfToken: vi.fn().mockResolvedValue('tok') }))
vi.mock('@/utils/azureRequestPayload', () => ({ azureCredPayload: () => ({}) }))

const { useAzureProjectData } = await import('@/components/MigrationWizard/hooks/useAzureProjectData')

describe('useAzureProjectData', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.includes('/api/azure/repos')) {
        return Promise.resolve({ ok: true, json: async () => ({ repos: [
          { name: 'Existing', isTfvc: false, isEmpty: false },
          { id: 'e1', name: 'EmptyOne', isTfvc: false, isEmpty: true, webUrl: 'u' },
          { name: 'TfvcThing', isTfvc: true },
        ] }) })
      }
      if (u.includes('/api/azure/projects')) {
        return Promise.resolve({ ok: true, json: async () => ({ projects: [{ id: 'p1', name: 'Proj', extra: 1 }] }) })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })
  })

  it('stays idle (no fetch) when not Azure DevOps', () => {
    renderHook(() => useAzureProjectData({ isAzureDevops: false, source: { org: 'o' }, targetProject: 'p' }))
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('loads repo names (lowercased Set, no TFVC), empty repos, and projects', async () => {
    const { result } = renderHook(() => useAzureProjectData({ isAzureDevops: true, source: { org: 'o' }, targetProject: 'p' }))
    await waitFor(() => {
      expect(result.current.azureProjectRepoNames).toBeInstanceOf(Set)
      expect(result.current.azureProjects).toHaveLength(1)
    })
    expect(result.current.azureProjectRepoNames.has('existing')).toBe(true)
    expect(result.current.azureProjectRepoNames.has('tfvcthing')).toBe(false) // TFVC excluded
    expect(result.current.azureEmptyRepos).toEqual([{ id: 'e1', name: 'EmptyOne', webUrl: 'u' }])
    expect(result.current.azureProjects).toEqual([{ id: 'p1', name: 'Proj' }]) // mapped to id+name only
  })
})
