import { describe, it, expect } from 'vitest'
import { isReplaceableConflict } from '../../../../src/components/MigrationWizard/steps/conflictRecovery'

describe('isReplaceableConflict', () => {
  it('true for a repo task failed with an already-exists conflict', () => {
    expect(isReplaceableConflict({
      type: 'repo', status: 'failed',
      error_message: 'Repository "x" already exists on GitHub and is not empty.',
    })).toBe(true)
  })

  it('true for a repo-tfvc task with the same conflict', () => {
    expect(isReplaceableConflict({
      type: 'repo-tfvc', status: 'failed', error_message: 'already exists on GitHub',
    })).toBe(true)
  })

  it('false for a non-conflict failure', () => {
    expect(isReplaceableConflict({ type: 'repo', status: 'failed', error_message: 'network error' })).toBe(false)
  })

  it('false for a non-repo task type', () => {
    expect(isReplaceableConflict({ type: 'wiki', status: 'failed', error_message: 'already exists' })).toBe(false)
  })

  it('false when not failed', () => {
    expect(isReplaceableConflict({ type: 'repo', status: 'complete', error_message: 'already exists' })).toBe(false)
  })
})
