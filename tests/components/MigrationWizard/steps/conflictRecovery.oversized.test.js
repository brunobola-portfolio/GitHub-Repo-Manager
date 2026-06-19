import { describe, it, expect } from 'vitest'
import { isOversizedFailure } from '../../../../src/components/MigrationWizard/steps/conflictRecovery'

describe('isOversizedFailure', () => {
  it('true for a repo task failed with the OVERSIZED_FILES sentinel', () => {
    expect(isOversizedFailure({
      type: 'repo', status: 'failed',
      error_message: 'OVERSIZED_FILES:{"files":[]}|3 file(s) exceeded GitHub\'s 100 MB limit during push.',
    })).toBe(true)
  })

  it('true for a plain "exceed 100 MB per-file" message', () => {
    expect(isOversizedFailure({
      type: 'repo-tfvc', status: 'failed',
      error_message: "3 files exceed GitHub's 100 MB per-file limit.",
    })).toBe(true)
  })

  it('false for a non-oversized failure', () => {
    expect(isOversizedFailure({ type: 'repo', status: 'failed', error_message: 'already exists on GitHub' })).toBe(false)
  })

  it('false for a non-repo task', () => {
    expect(isOversizedFailure({ type: 'wiki', status: 'failed', error_message: 'OVERSIZED_FILES:{}' })).toBe(false)
  })

  it('false when not failed', () => {
    expect(isOversizedFailure({ type: 'repo', status: 'complete', error_message: 'OVERSIZED_FILES:{}' })).toBe(false)
  })
})
