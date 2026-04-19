import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMigrationWizard } from '@/hooks/useMigrationWizard'

describe('useMigrationWizard', () => {
  // Wizard now persists a credential-scrubbed draft to sessionStorage so a
  // refresh mid-flow doesn't nuke progress. Reset between tests so one test's
  // state doesn't hydrate into the next and make these checks non-deterministic.
  beforeEach(() => {
    try { window.sessionStorage.clear() } catch { /* happy-dom always has it */ }
  })

  it('starts at source step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    expect(result.current.currentStep).toBe('sourceType')
  })

  it('has all 8 azure steps', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    expect(result.current.steps).toHaveLength(8)
  })

  it('does not advance from source without validation', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.nextStep())
    expect(result.current.currentStep).toBe('sourceType')
    expect(result.current.error).toBeTruthy()
  })

  it('advances when source is valid', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // Set sourceType first so azure steps are available
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'pat', validated: true }))
    act(() => result.current.nextStep()) // azureConnect → repoSelect
    expect(result.current.currentStep).toBe('repoSelect')
    expect(result.current.error).toBeNull()
  })

  it('goes back to previous step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // azureConnect → repoSelect
    act(() => result.current.prevStep())
    expect(result.current.currentStep).toBe('azureConnect')
  })

  it('skips disabled workItems and wiki steps', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // Set sourceType first so azure steps are available
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    // AzureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // → repoSelect
    // RepoSelect
    act(() =>
      result.current.setRepos([
        { name: 'r', selected: true, targetName: 'r', visibility: 'private', description: '' },
      ])
    )
    act(() => result.current.nextStep()) // → repoConfig
    // RepoConfig
    act(() => result.current.nextStep()) // should skip workItems + wiki → aiReview
    expect(result.current.currentStep).toBe('aiReview')
  })

  it('does not skip workItems when enabled', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // → repoSelect
    act(() =>
      result.current.setRepos([
        { name: 'r', selected: true, targetName: 'r', visibility: 'private', description: '' },
      ])
    )
    act(() => result.current.nextStep()) // → repoConfig
    act(() => result.current.updateWorkItems({ enabled: true, types: ['Bug'] }))
    act(() => result.current.nextStep()) // → workItems
    expect(result.current.currentStep).toBe('workItems')
  })

  it('resets all state', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() =>
      result.current.updateSource({ org: 'test', project: 'test', pat: 'p', validated: true })
    )
    act(() => result.current.resetWizard())
    expect(result.current.currentStep).toBe('sourceType')
    expect(result.current.source.org).toBe('')
  })

  it('clears error on successful navigation', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // At sourceType: nextStep without sourceType set should fail
    act(() => result.current.nextStep())
    expect(result.current.error).toBeTruthy()
    // Set sourceType to clear error and advance
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    expect(result.current.error).toBeNull()
  })

  it('skips disabled steps when going back', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // Navigate to aiReview with workItems and wiki disabled
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // → repoSelect
    act(() =>
      result.current.setRepos([
        { name: 'r', selected: true, targetName: 'r', visibility: 'private', description: '' },
      ])
    )
    act(() => result.current.nextStep()) // → repoConfig
    act(() => result.current.nextStep()) // → aiReview (skips workItems + wiki)
    expect(result.current.currentStep).toBe('aiReview')
    // Go back should skip wiki and workItems → repoConfig
    act(() => result.current.prevStep())
    expect(result.current.currentStep).toBe('repoConfig')
  })

  it('goToStep only navigates to completed steps', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // Try to go to a future step
    act(() => result.current.goToStep('repoSelect'))
    expect(result.current.currentStep).toBe('sourceType')
    // Advance and then go back via goToStep
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // → repoSelect
    act(() => result.current.goToStep('sourceType'))
    expect(result.current.currentStep).toBe('sourceType')
  })

  it('canGoBack is false at first step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    expect(result.current.canGoBack).toBe(false)
  })

  it('canGoNext is false at last step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // At first step with no sourceType set, steps = ['sourceType'] (length 1), so canGoNext is false
    expect(result.current.canGoNext).toBe(false)
  })

  it('updateRepo modifies a specific repo', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() =>
      result.current.setRepos([
        { name: 'a', selected: false, targetName: 'a' },
        { name: 'b', selected: false, targetName: 'b' },
      ])
    )
    act(() => result.current.updateRepo(1, { selected: true }))
    expect(result.current.repos[0].selected).toBe(false)
    expect(result.current.repos[1].selected).toBe(true)
  })

  it('updateSchedule merges into schedule state', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.updateSchedule({ mode: 'scheduled', scheduledAt: '2026-04-01' }))
    expect(result.current.schedule.mode).toBe('scheduled')
    expect(result.current.schedule.scheduledAt).toBe('2026-04-01')
    expect(result.current.schedule.isDryRun).toBe(false) // unchanged
  })

  it('setPlanId stores the plan ID', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.setPlanId(42))
    expect(result.current.planId).toBe(42)
  })

  it('validates repoSelect requires selected repos', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // → repoSelect
    act(() =>
      result.current.setRepos([{ name: 'r', selected: false, targetName: 'r' }])
    )
    act(() => result.current.nextStep()) // should fail
    expect(result.current.currentStep).toBe('repoSelect')
    expect(result.current.error).toBe('Select at least one repository')
  })

  it('validates repoConfig requires target names', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // → repoSelect
    act(() =>
      result.current.setRepos([
        { name: 'r', selected: true, targetName: '', visibility: 'private' },
      ])
    )
    act(() => result.current.nextStep()) // → repoConfig
    act(() => result.current.nextStep()) // should fail
    expect(result.current.currentStep).toBe('repoConfig')
    expect(result.current.error).toBe('All repositories need a target name')
  })

  it('validates repoConfig requires unique target names', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // → repoSelect
    act(() =>
      result.current.setRepos([
        { name: 'a', selected: true, targetName: 'same', visibility: 'private' },
        { name: 'b', selected: true, targetName: 'same', visibility: 'private' },
      ])
    )
    act(() => result.current.nextStep()) // → repoConfig
    act(() => result.current.nextStep()) // should fail
    expect(result.current.currentStep).toBe('repoConfig')
    expect(result.current.error).toBe('Target names must be unique')
  })

  it('validates schedule requires date when mode is scheduled', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // Navigate to schedule step
    act(() => result.current.updateSource({ sourceType: 'azure' }))
    act(() => result.current.nextStep()) // sourceType → azureConnect
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // → repoSelect
    act(() =>
      result.current.setRepos([
        { name: 'r', selected: true, targetName: 'r', visibility: 'private', description: '' },
      ])
    )
    act(() => result.current.nextStep()) // → repoConfig
    act(() => result.current.nextStep()) // → aiReview (skip workItems + wiki)
    act(() => result.current.nextStep()) // → schedule
    expect(result.current.currentStep).toBe('schedule')
    act(() => result.current.updateSchedule({ mode: 'scheduled' }))
    act(() => result.current.nextStep()) // should fail
    expect(result.current.currentStep).toBe('schedule')
    expect(result.current.error).toBe('Select a date and time')
  })

  it('seeds source fields from initialSource option', () => {
    const { result } = renderHook(() =>
      useMigrationWizard({
        initialSource: {
          sourceType: 'azure',
          org: 'bruno',
          project: 'AWIP',
          targetOrg: 'bolalabs',
          targetName: 'AWIP',
        },
      })
    )
    expect(result.current.source.sourceType).toBe('azure')
    expect(result.current.source.org).toBe('bruno')
    expect(result.current.source.project).toBe('AWIP')
    expect(result.current.source.targetOrg).toBe('bolalabs')
    expect(result.current.source.targetName).toBe('AWIP')
  })

  it('seeds repos from initialRepos option (used for Azure single-repo auto-select)', () => {
    const { result } = renderHook(() =>
      useMigrationWizard({
        initialSource: { sourceType: 'azure' },
        initialRepos: [
          { id: 'seed-1', name: 'Cacadores', selected: true, targetName: 'Cacadores' },
        ],
      })
    )
    expect(result.current.repos).toHaveLength(1)
    expect(result.current.repos[0].selected).toBe(true)
    expect(result.current.repos[0].name).toBe('Cacadores')
  })

  it('starts at initialStep when provided and valid for the sourceType', () => {
    const { result } = renderHook(() =>
      useMigrationWizard({
        initialSource: { sourceType: 'azure' },
        initialStep: 'repoConfig',
      })
    )
    expect(result.current.currentStep).toBe('repoConfig')
  })

  it('falls back to step 0 when initialStep does not exist in the sourceType flow', () => {
    const { result } = renderHook(() =>
      useMigrationWizard({
        initialSource: { sourceType: 'github' },
        initialStep: 'repoConfig', // github flow has no repoConfig
      })
    )
    expect(result.current.currentStep).toBe('sourceType')
  })

  it('remains backward-compatible when called with no options (INITIAL_SOURCE used)', () => {
    const { result } = renderHook(() => useMigrationWizard())
    expect(result.current.currentStep).toBe('sourceType')
    expect(result.current.source.sourceType).toBe('')
    expect(result.current.repos).toEqual([])
  })
})
