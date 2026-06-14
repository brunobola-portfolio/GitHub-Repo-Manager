import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/utils/api', () => ({ getCsrfToken: vi.fn().mockResolvedValue('tok') }))

const { useRepoNameConflicts } = await import('@/components/MigrationWizard/hooks/useRepoNameConflicts')

const base = { source: { org: 'o', targetOrg: 'to' } }
// Stable references — the re-seed effect deps on `repos`, and in the real
// component `repos` is a stable prop; a fresh `[]` per render would loop.
const NO_REPOS = []

describe('useRepoNameConflicts', () => {
  beforeEach(() => { global.fetch = vi.fn() })

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
