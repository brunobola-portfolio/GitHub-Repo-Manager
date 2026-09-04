import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ApiError, ErrorType } from '@/utils/api'

// Mock the config module to control MOCK_MODE
vi.mock('@/config', () => ({
  MOCK_MODE: true,
  API_ENDPOINTS: {
    user: '/api/user',
    repos: '/api/repos',
    visibility: '/api/visibility',
    transfer: '/api/transfer',
    mirror: '/api/mirror',
  },
  PAGINATION: {
    defaultPerPage: 30,
    perPageOptions: [10, 30, 50, 100],
  },
}))

// Must import after mocking
const { useGitHub } = await import('@/hooks/useGitHub')

describe('useGitHub', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initial State (Mock Mode)', () => {
    it('returns all expected properties', () => {
      const { result } = renderHook(() => useGitHub())

      // Core data
      expect(result.current).toHaveProperty('user')
      expect(result.current).toHaveProperty('repos')
      expect(result.current).toHaveProperty('loading')
      expect(result.current).toHaveProperty('error')
      expect(result.current).toHaveProperty('errorInfo')
      expect(result.current).toHaveProperty('message')

      // Pagination
      expect(result.current).toHaveProperty('page')
      expect(result.current).toHaveProperty('perPage')
      expect(result.current).toHaveProperty('totalPages')
      expect(result.current).toHaveProperty('setPage')

      // Actions
      expect(result.current).toHaveProperty('performAction')
      expect(result.current).toHaveProperty('fetchUser')
      expect(result.current).toHaveProperty('refresh')
      expect(result.current).toHaveProperty('createRepo')
      expect(result.current).toHaveProperty('deleteRepos')
      expect(result.current).toHaveProperty('archiveRepos')

      // Organizations
      expect(result.current).toHaveProperty('orgs')
      expect(result.current).toHaveProperty('selectedOrg')
      expect(result.current).toHaveProperty('orgRepos')
      expect(result.current).toHaveProperty('fetchOrgs')
      expect(result.current).toHaveProperty('fetchOrgRepos')
      expect(result.current).toHaveProperty('setSelectedOrg')

      // Stats & Activity
      expect(result.current).toHaveProperty('stats')
      expect(result.current).toHaveProperty('fetchStats')
      expect(result.current).toHaveProperty('activity')

      // AI
      expect(result.current).toHaveProperty('askAI')
      expect(result.current).toHaveProperty('checkAIStatus')

      // Status flags
      expect(result.current).toHaveProperty('isPerforming')
      expect(result.current).toHaveProperty('results')
      expect(result.current).toHaveProperty('isMockMode')

      // Local patch helpers (in-place updates after RepoDetail mutations)
      expect(result.current).toHaveProperty('patchRepoLocal')
      expect(result.current).toHaveProperty('patchOrgRepoLocal')
      expect(result.current).toHaveProperty('patchRepoEverywhere')
    })

    it('populates mock user in mock mode', async () => {
      const { result } = renderHook(() => useGitHub())

      await waitFor(() => {
        expect(result.current.user).not.toBeNull()
      })

      expect(result.current.user.login).toBe('dev-user')
      expect(result.current.user.name).toBeTruthy()
    })

    it('populates mock repos in mock mode', async () => {
      const { result } = renderHook(() => useGitHub())

      await waitFor(() => {
        expect(result.current.repos.length).toBeGreaterThan(0)
      })

      const firstRepo = result.current.repos[0]
      expect(firstRepo).toHaveProperty('id')
      expect(firstRepo).toHaveProperty('name')
      expect(firstRepo).toHaveProperty('full_name')
      expect(firstRepo).toHaveProperty('description')
      expect(firstRepo).toHaveProperty('language')
      expect(firstRepo).toHaveProperty('stargazers_count')
      expect(firstRepo).toHaveProperty('private')
      expect(firstRepo).toHaveProperty('html_url')
      expect(firstRepo).toHaveProperty('updated_at')
      expect(firstRepo).toHaveProperty('owner')
    })

    it('generates correct pagination in mock mode', async () => {
      const { result } = renderHook(() => useGitHub())

      await waitFor(() => {
        expect(result.current.totalPages).not.toBeNull()
      })

      expect(result.current.page).toBe(1)
      expect(result.current.perPage).toBe(30)
      expect(result.current.totalPages).toBeGreaterThanOrEqual(1)
    })

    it('reports isMockMode as true', () => {
      const { result } = renderHook(() => useGitHub())
      expect(result.current.isMockMode).toBe(true)
    })

    it('starts with no errors', () => {
      const { result } = renderHook(() => useGitHub())
      expect(result.current.error).toBeNull()
      expect(result.current.errorInfo).toBeNull()
    })

  })

  describe('Pagination (Mock Mode)', () => {
    it('changes page via setPage', async () => {
      const { result } = renderHook(() => useGitHub())

      act(() => {
        result.current.setPage(2)
      })

      await waitFor(() => {
        expect(result.current.page).toBe(2)
      })
    })

  })

  describe('Error Handling', () => {
    it('handles ApiError instances correctly', () => {
      const apiError = new ApiError(ErrorType.AUTHENTICATION, 'Auth failed', 401)
      expect(apiError.type).toBe(ErrorType.AUTHENTICATION)
      expect(apiError.userMessage).toBe('Your session expired. Sign in again to continue.')
      expect(apiError.status).toBe(401)
      expect(apiError.isRetryable).toBe(false)
    })

    it('marks network errors as retryable', () => {
      const networkError = new ApiError(ErrorType.NETWORK, 'Network error')
      expect(networkError.isRetryable).toBe(true)
    })

    it('marks server errors as retryable', () => {
      const serverError = new ApiError(ErrorType.SERVER, 'Server error', 500)
      expect(serverError.isRetryable).toBe(true)
    })

    it('marks authorization errors as non-retryable', () => {
      const authzError = new ApiError(ErrorType.AUTHORIZATION, 'Forbidden', 403)
      expect(authzError.isRetryable).toBe(false)
    })
  })

  describe('Action Functions', () => {
    it('all action functions are callable', () => {
      const { result } = renderHook(() => useGitHub())

      expect(typeof result.current.performAction).toBe('function')
      expect(typeof result.current.fetchUser).toBe('function')
      expect(typeof result.current.refresh).toBe('function')
      expect(typeof result.current.createRepo).toBe('function')
      expect(typeof result.current.deleteRepos).toBe('function')
      expect(typeof result.current.archiveRepos).toBe('function')
      expect(typeof result.current.fetchOrgs).toBe('function')
      expect(typeof result.current.fetchOrgRepos).toBe('function')
      expect(typeof result.current.fetchStats).toBe('function')
      expect(typeof result.current.askAI).toBe('function')
      expect(typeof result.current.checkAIStatus).toBe('function')
      expect(typeof result.current.importFromAzure).toBe('function')
    })
  })

  describe('Mock Data Quality', () => {
    it('mock repos have realistic structure', async () => {
      const { result } = renderHook(() => useGitHub())

      await waitFor(() => {
        expect(result.current.repos.length).toBeGreaterThan(0)
      })

      for (const repo of result.current.repos) {
        expect(typeof repo.id).toBe('number')
        expect(typeof repo.name).toBe('string')
        expect(repo.name.length).toBeGreaterThan(0)
        expect(typeof repo.stargazers_count).toBe('number')
        expect(repo.stargazers_count).toBeGreaterThanOrEqual(0)
        expect(typeof repo.private).toBe('boolean')
      }
    })

    it('mock repos include diverse languages', async () => {
      const { result } = renderHook(() => useGitHub())

      await waitFor(() => {
        expect(result.current.repos.length).toBeGreaterThan(0)
      })

      const languages = new Set(result.current.repos.map(r => r.language))
      expect(languages.size).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Local repo patching', () => {
    it('patchRepoEverywhere mutates the personal list in place by id', async () => {
      const { result } = renderHook(() => useGitHub())

      await waitFor(() => {
        expect(result.current.repos.length).toBeGreaterThan(0)
      })

      const target = result.current.repos[0]
      const originalDescription = target.description

      act(() => {
        result.current.patchRepoEverywhere({ id: target.id, description: 'patched description' })
      })

      const updated = result.current.repos.find(r => r.id === target.id)
      expect(updated.description).toBe('patched description')
      // Other fields preserved
      expect(updated.full_name).toBe(target.full_name)
      // Other repos untouched
      const others = result.current.repos.filter(r => r.id !== target.id)
      expect(others.every(r => r.description !== 'patched description')).toBe(true)
      // Sanity: the original description actually changed
      expect(updated.description).not.toBe(originalDescription)
    })

    it('patchRepoEverywhere is a no-op when nothing matches', async () => {
      const { result } = renderHook(() => useGitHub())

      await waitFor(() => {
        expect(result.current.repos.length).toBeGreaterThan(0)
      })

      const before = result.current.repos
      act(() => {
        result.current.patchRepoEverywhere({ id: -999, description: 'ghost' })
      })
      // Same shape, no description leaked
      expect(result.current.repos).toHaveLength(before.length)
      expect(result.current.repos.every(r => r.description !== 'ghost')).toBe(true)
    })
  })
})
