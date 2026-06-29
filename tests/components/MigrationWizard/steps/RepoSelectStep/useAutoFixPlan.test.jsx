// tests/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { makeRepo } from './fixtures.js'

// Stub CSRF token fetch so mockFetchImpl only needs to match the AI endpoint.
vi.mock('../../../../../src/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'test-csrf-token'),
}))

const { useAutoFixPlan } = await import('../../../../../src/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.js')

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

  it('Phase 2 attaches the X-CSRF-Token header on the check-duplicates POST', async () => {
    // Regression: the Phase-2 fetch previously sent no CSRF header, so the
    // global requireCsrfToken guard 403'd it on every fire (silently degrading
    // every conflict status to 'unchecked'). It must mint + send the token.
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: {} } } })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    await waitFor(() => {
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('check-duplicates'))
      expect(call).toBeTruthy()
      expect(call[1].headers['X-CSRF-Token']).toBe('test-csrf-token')
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
    const repos = [makeRepo({ id: 'a', name: 'huge', size: 11 * 1024 * 1024 * 1024, selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    // 'huge' is not in RESERVED_NAMES, so plan is empty: no duplicates call fires.
    // Wait for the hook to report that it is not loading AI (i.e. Phase 3 was skipped).
    await waitFor(() => expect(result.current.isAILoading).toBe(false))
    const aiCalls = global.fetch.mock.calls.filter((c) => c[0].includes('migration-size-strategy'))
    expect(aiCalls).toHaveLength(0)
  })

  it('Phase 3 calls AI endpoint for each size-critical repo when aiAvailable', async () => {
    mockFetchImpl({
      'check-duplicates': { body: { duplicates: {} } },
      'migration-size-strategy': { body: { strategy: 'lfs-migrate', rationale: 'r', confidence: 0.7 } },
    })
    const repos = [
      makeRepo({ id: 'a', name: 'huge', size: 11 * 1024 * 1024 * 1024, selected: true }),
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

  it('Phase 2 conflict=true maps to status conflict', async () => {
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: { 'api-repo': true } } } })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    await waitFor(() => {
      expect(result.current.conflictStatuses['a']).toBe('conflict')
    })
  })

  it('Phase 2 401 sets auth error and does not set conflict status', async () => {
    mockFetchImpl({ 'check-duplicates': { ok: false, status: 401, body: {} } })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    await waitFor(() => {
      expect(result.current.error).toEqual({ type: 'auth', message: expect.any(String) })
    })
    expect(result.current.conflictStatuses['a']).toBeUndefined()
  })

  it('Phase 3 429 sets ai-quota error and skips suggestions for quota-hit repos', async () => {
    mockFetchImpl({
      'check-duplicates': { body: { duplicates: {} } },
      'migration-size-strategy': { ok: false, status: 429, body: {} },
    })
    const repos = [makeRepo({ id: 'a', name: 'huge', size: 11 * 1024 * 1024 * 1024, selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: true }),
    )
    await waitFor(() => {
      expect(result.current.error).toEqual({ type: 'ai-quota', message: expect.any(String) })
    })
    expect(result.current.aiSuggestions['a']).toBeUndefined()
  })

  it('Phase 1 emits a rename when the conflicts prop flags a target-org collision', () => {
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: {} } } })
    const repos = [makeRepo({ id: 'm', name: 'MainSite', selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({
        repos,
        allRepos: repos,
        targetOrg: 'BolaLabs',
        azureProject: 'BolaLabs',
        conflicts: { MainSite: true },
        aiAvailable: false,
      }),
    )
    expect(result.current.plan).toHaveLength(1)
    expect(result.current.plan[0]).toMatchObject({
      type: 'name-conflict',
      from: 'MainSite',
      to: 'BolaLabs-MainSite',
    })
  })

  it('Phase 3 AI suggestion persists for size-critical repo without a rename blocker', async () => {
    mockFetchImpl({
      'check-duplicates': { body: { duplicates: {} } },
      'migration-size-strategy': { body: { strategy: 'exclude', rationale: 'stale', confidence: 0.9 } },
    })
    // A size-critical repo with a VALID name — no rename blocker → not in plan.
    const repos = [makeRepo({ id: 'big', name: 'valid-name', size: 11 * 1024 * 1024 * 1024, selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: true }),
    )
    await waitFor(() => {
      expect(result.current.aiSuggestions['big']).toEqual({
        strategy: 'exclude',
        rationale: 'stale',
        confidence: 0.9,
      })
    })
    // plan should be empty — no rename blockers
    expect(result.current.plan).toHaveLength(0)
  })
})
