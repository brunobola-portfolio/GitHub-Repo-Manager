import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { _resetCsrfTokenForTests } from '@/utils/api'

const { useRepoNameConflicts } = await import('@/components/MigrationWizard/hooks/useRepoNameConflicts')

const JSON_HEADERS = { get: (k) => (k?.toLowerCase?.() === 'content-type' ? 'application/json' : null) }

const base = { source: { org: 'o', targetOrg: 'to' } }
// Stable references — the re-seed effect deps on `repos`, and in the real
// component `repos` is a stable prop; a fresh `[]` per render would loop.
const NO_REPOS = []

describe('useRepoNameConflicts', () => {
  beforeEach(() => {
    _resetCsrfTokenForTests()
    global.fetch = vi.fn()
  })

  it('seeds from repo.risk name-conflict flags on mount', () => {
    const repos = [
      { name: 'a', risk: { flags: [{ type: 'name-conflict' }] } },
      { name: 'b', targetName: 'bTarget' },
      { name: 'c' },
    ]
    const { result } = renderHook(() => useRepoNameConflicts({ ...base, isAzureDevops: false, azureProjectRepoNames: null, repos }))
    expect(result.current.conflicts).toEqual({ a: 'conflict', b: 'clear' })
  })

  it('Azure mode: detects conflicts locally against the project repo names (no fetch)', () => {
    const names = new Set(['taken'])
    const { result } = renderHook(() => useRepoNameConflicts({ ...base, isAzureDevops: true, azureProjectRepoNames: names, repos: NO_REPOS }))
    act(() => { result.current.checkConflict('r', 'Taken') })   // case-insensitive
    expect(result.current.conflicts.r).toBe('conflict')
    act(() => { result.current.checkConflict('r', 'Free') })
    expect(result.current.conflicts.r).toBe('clear')
    act(() => { result.current.checkConflict('r', '   ') })     // blank → idle
    expect(result.current.conflicts.r).toBe('idle')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('exposes setConflicts for direct status pokes', () => {
    const names = new Set()
    const { result } = renderHook(() => useRepoNameConflicts({ ...base, isAzureDevops: true, azureProjectRepoNames: names, repos: NO_REPOS }))
    act(() => { result.current.setConflicts((p) => ({ ...p, x: 'idle' })) })
    expect(result.current.conflicts.x).toBe('idle')
  })

  it('mount-seed: repo with conflictAction=replace and name-conflict risk flag seeds to will-replace, not conflict', () => {
    // This test exercises the mount-seed effect (empty dep array).
    // Without Fix 1b the name-conflict flag would overwrite 'will-replace' with 'conflict'.
    const repos = [
      {
        name: 'mig',
        targetName: 'mig',
        conflictAction: 'replace',
        risk: { flags: [{ type: 'name-conflict' }] },
      },
    ]
    const { result } = renderHook(() =>
      useRepoNameConflicts({ ...base, isAzureDevops: false, azureProjectRepoNames: null, repos })
    )
    expect(result.current.conflicts.mig).toBe('will-replace')
  })

  it('GitHub path: omits targetOwner from the POST body when no targetOrg is set (falls back to authed user on server)', async () => {
    // source has no targetOrg — the engine resolves owner from the session user.
    // The hook must NOT substitute source.org as the owner.
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.includes('csrf-token')) {
        return Promise.resolve({ ok: true, json: async () => ({ token: 'tok' }), headers: JSON_HEADERS })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ duplicates: { 'my-repo': false }, duplicateDetails: {} }),
        headers: JSON_HEADERS,
      })
    })
    const noOrg = { source: { org: 'azure-org', targetOrg: undefined } }
    const { result } = renderHook(() =>
      useRepoNameConflicts({ ...noOrg, isAzureDevops: false, azureProjectRepoNames: null, repos: NO_REPOS })
    )
    act(() => { result.current.checkConflict('my-repo', 'my-repo') })
    // Wait for the debounced fetch (500ms)
    await act(() => new Promise((r) => setTimeout(r, 600)))
    expect(global.fetch).toHaveBeenCalledTimes(2) // 1 CSRF token fetch + 1 check-duplicates POST
    const postCall = global.fetch.mock.calls.find(([callUrl]) => String(callUrl).includes('check-duplicates'))
    const body = JSON.parse(postCall[1].body)
    // targetOwner must be omitted or undefined — never the Azure org string.
    expect(body.targetOwner).toBeUndefined()
  })

  it('Azure re-seed: repo with conflictAction=replace is not clobbered to conflict when its name is in azureProjectRepoNames', () => {
    // This test exercises the Azure re-seed effect (deps: azureProjectRepoNames, isAzureDevops, repos).
    // Without Fix 1a the re-seed would overwrite 'will-replace' with 'conflict'.
    const repos = [
      {
        name: 'taken',
        targetName: 'taken',
        conflictAction: 'replace',
        risk: { flags: [] },
      },
    ]
    // 'taken' is in the project — without the guard it would become 'conflict'
    const names = new Set(['taken'])
    const { result } = renderHook(() =>
      useRepoNameConflicts({ ...base, isAzureDevops: true, azureProjectRepoNames: names, repos })
    )
    expect(result.current.conflicts.taken).toBe('will-replace')
  })
})
