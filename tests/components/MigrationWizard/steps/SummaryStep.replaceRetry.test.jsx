import { describe, it, expect } from 'vitest'
import { isConflictError } from '../../../../src/components/MigrationWizard/steps/conflictRecovery'

describe('isConflictError', () => {
  it('true for a repo error that already exists', () => {
    expect(isConflictError({ type: 'repo', error: 'Repository "x" already exists on GitHub' })).toBe(true)
  })

  it('true for repo-tfvc', () => {
    expect(isConflictError({ type: 'repo-tfvc', error: 'already exists' })).toBe(true)
  })

  it('false for non-repo type', () => {
    expect(isConflictError({ type: 'wiki', error: 'already exists' })).toBe(false)
  })

  it('false for non-conflict error', () => {
    expect(isConflictError({ type: 'repo', error: 'timeout' })).toBe(false)
  })
})
