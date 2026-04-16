// tests/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAutoFixPlan } from '../../../../../src/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.js'
import { makeRepo } from './fixtures.js'

beforeEach(() => {
  global.fetch = vi.fn()
})
afterEach(() => {
  vi.resetAllMocks()
})

function mockFetchImpl(responses) {
  global.fetch.mockImplementation(async (url) => {
    const handler = Object.keys(responses).find((k) => url.includes(k))
    if (!handler) throw new Error(`Unmocked fetch: ${url}`)
    return {
      ok: responses[handler].ok ?? true,
      status: responses[handler].status ?? 200,
      json: async () => responses[handler].body,
    }
  })
}

describe('useAutoFixPlan', () => {
  it('Phase 1 returns a synchronous plan on mount', () => {
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: {} } } })
    const repos = [
      makeRepo({ id: 'a', name: 'api', selected: true }),
      makeRepo({ id: 'b', name: 'ok', selected: true }),
    ]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    expect(result.current.plan).toHaveLength(1)
    expect(result.current.plan[0].type).toBe('reserved-name')
  })

  it('Phase 2 marks items clear/conflict based on check-duplicates response', async () => {
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: { 'api-repo': false } } } })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    await waitFor(() => {
      expect(result.current.conflictStatuses['a']).toBe('clear')
    })
  })

  it('Phase 2 sets unchecked on fetch failure (5xx)', async () => {
    mockFetchImpl({ 'check-duplicates': { ok: false, status: 500, body: {} } })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    await waitFor(() => {
      expect(result.current.conflictStatuses['a']).toBe('unchecked')
    })
  })

  it('Phase 3 skips when aiAvailable is false', async () => {
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: {} } } })
    const repos = [makeRepo({ id: 'a', name: 'huge', size: 11 * 1024 * 1024, selected: true })]
    renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    await new Promise((r) => setTimeout(r, 20))
    const aiCalls = global.fetch.mock.calls.filter((c) => c[0].includes('migration-size-strategy'))
    expect(aiCalls).toHaveLength(0)
  })

  it('Phase 3 calls AI endpoint for each size-critical repo when aiAvailable', async () => {
    mockFetchImpl({
      'check-duplicates': { body: { duplicates: {} } },
      'migration-size-strategy': { body: { strategy: 'lfs-migrate', rationale: 'r', confidence: 0.7 } },
    })
    const repos = [
      makeRepo({ id: 'a', name: 'huge', size: 11 * 1024 * 1024, selected: true }),
    ]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: true }),
    )
    await waitFor(() => {
      expect(result.current.aiSuggestions['a']).toEqual({
        strategy: 'lfs-migrate',
        rationale: 'r',
        confidence: 0.7,
      })
    })
  })

  it('aborts in-flight fetches on unmount', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: {} } } })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    const { unmount } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    unmount()
    expect(abortSpy).toHaveBeenCalled()
    abortSpy.mockRestore()
  })
})
