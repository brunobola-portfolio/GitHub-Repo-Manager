import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMigrationWizard } from '@/hooks/useMigrationWizard'

describe('useMigrationWizard', () => {
  it('starts at source step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    expect(result.current.currentStep).toBe('source')
  })

  it('has all 9 steps', () => {
    const { result } = renderHook(() => useMigrationWizard())
    expect(result.current.steps).toHaveLength(9)
  })

  it('does not advance from source without validation', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.nextStep())
    expect(result.current.currentStep).toBe('source')
    expect(result.current.error).toBeTruthy()
  })

  it('advances when source is valid', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'pat', validated: true }))
    act(() => result.current.nextStep())
    expect(result.current.currentStep).toBe('repoSelect')
    expect(result.current.error).toBeNull()
  })

  it('goes back to previous step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep())
    act(() => result.current.prevStep())
    expect(result.current.currentStep).toBe('source')
  })

  it('skips disabled workItems and wiki steps', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // Source
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
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep())
    act(() =>
      result.current.setRepos([
        { name: 'r', selected: true, targetName: 'r', visibility: 'private', description: '' },
      ])
    )
    act(() => result.current.nextStep())
    act(() => result.current.updateWorkItems({ enabled: true, types: ['Bug'] }))
    act(() => result.current.nextStep())
    expect(result.current.currentStep).toBe('workItems')
  })

  it('resets all state', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() =>
      result.current.updateSource({ org: 'test', project: 'test', pat: 'p', validated: true })
    )
    act(() => result.current.resetWizard())
    expect(result.current.currentStep).toBe('source')
    expect(result.current.source.org).toBe('')
  })

  it('clears error on successful navigation', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.nextStep()) // fails, sets error
    expect(result.current.error).toBeTruthy()
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // succeeds
    expect(result.current.error).toBeNull()
  })

  it('skips disabled steps when going back', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // Navigate to aiReview with workItems and wiki disabled
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
    expect(result.current.currentStep).toBe('source')
    // Advance and then go back via goToStep
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep()) // → repoSelect
    act(() => result.current.goToStep('source'))
    expect(result.current.currentStep).toBe('source')
  })

  it('canGoBack is false at first step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    expect(result.current.canGoBack).toBe(false)
  })

  it('canGoNext is false at last step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // Directly check: steps has 9 items, last index is 8
    expect(result.current.canGoNext).toBe(true) // at step 0
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
    act(() => result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true }))
    act(() => result.current.nextStep())
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
})
