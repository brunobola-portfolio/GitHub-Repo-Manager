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
})
