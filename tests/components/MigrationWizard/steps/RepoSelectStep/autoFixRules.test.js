// tests/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.test.js
import { describe, it, expect } from 'vitest'
import {
  fixInvalidChars,
  fixReserved,
  fixDuplicates,
  fixNameConflict,
  buildDeterministicPlan,
} from '../../../../../src/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.js'
import { makeRepo } from './fixtures.js'

describe('fixInvalidChars', () => {
  it('replaces invalid chars with hyphens', () => {
    const result = fixInvalidChars(makeRepo({ name: 'my repo!' }))
    expect(result).toEqual({
      type: 'invalid-chars',
      from: 'my repo!',
      to: 'my-repo-',
      reason: 'Replaced characters GitHub does not accept.',
    })
  })
  it('returns null when name is already valid', () => {
    expect(fixInvalidChars(makeRepo({ name: 'valid-name' }))).toBeNull()
  })
  it('collapses consecutive invalid runs into a single hyphen', () => {
    expect(fixInvalidChars(makeRepo({ name: 'a  b / c' })).to).toBe('a-b-c')
  })
  it('strips leading and trailing hyphens', () => {
    expect(fixInvalidChars(makeRepo({ name: '!hello!' })).to).toBe('hello')
  })
  it('keeps trailing hyphen when only the end is invalid (spec behavior)', () => {
    // The spec §7.1 requires 'my repo!' → 'my-repo-' — trailing hyphens from
    // invalid trailing chars are preserved to signal the auto-fix origin.
    expect(fixInvalidChars(makeRepo({ name: 'hello!' })).to).toBe('hello-')
  })
})

describe('fixReserved', () => {
  it('suffixes reserved names with -repo', () => {
    expect(fixReserved(makeRepo({ name: 'api' }))).toEqual({
      type: 'reserved-name',
      from: 'api',
      to: 'api-repo',
      reason: 'GitHub reserves this name; added "-repo" suffix.',
    })
  })
  it('is case-insensitive', () => {
    expect(fixReserved(makeRepo({ name: 'API' })).to).toBe('API-repo')
  })
  it('returns null for non-reserved names', () => {
    expect(fixReserved(makeRepo({ name: 'my-repo' }))).toBeNull()
  })
})

describe('fixDuplicates', () => {
  it('suffixes -1, -2 on consecutive duplicates', () => {
    const a = makeRepo({ id: 'a', name: 'dup', selected: true })
    const b = makeRepo({ id: 'b', name: 'dup', selected: true })
    const c = makeRepo({ id: 'c', name: 'dup', selected: true })
    const ctx = { allRepos: [a, b, c] }
    expect(fixDuplicates(a, ctx)).toBeNull() // first stays
    expect(fixDuplicates(b, ctx).to).toBe('dup-1')
    expect(fixDuplicates(c, ctx).to).toBe('dup-2')
  })
  it('ignores unselected duplicates', () => {
    const a = makeRepo({ id: 'a', name: 'dup', selected: true })
    const b = makeRepo({ id: 'b', name: 'dup', selected: false })
    expect(fixDuplicates(a, { allRepos: [a, b] })).toBeNull()
  })
  it('returns null when repo is not present in allRepos', () => {
    const a = makeRepo({ id: 'a', name: 'dup', selected: true })
    const orphan = makeRepo({ id: 'orphan', name: 'dup', selected: true })
    expect(fixDuplicates(orphan, { allRepos: [a] })).toBeNull()
  })
})

describe('fixNameConflict', () => {
  it('prefixes the Azure project name when target already has the repo', () => {
    const ctx = { conflicts: { existing: true }, azureProject: 'MyProj', allRepos: [] }
    expect(fixNameConflict(makeRepo({ name: 'existing' }), ctx)).toEqual({
      type: 'name-conflict',
      from: 'existing',
      to: 'MyProj-existing',
      reason: 'Prefixed with Azure project name to avoid target-org collision.',
    })
  })
  it('returns null when no conflict', () => {
    expect(fixNameConflict(makeRepo({ name: 'clean' }), { conflicts: {}, allRepos: [] })).toBeNull()
  })
})

describe('buildDeterministicPlan', () => {
  it('returns one FixItem per blocker, keyed by repoIndex', () => {
    const repos = [
      makeRepo({ id: 'a', name: 'api', selected: true }),
      makeRepo({ id: 'b', name: 'ok-name', selected: true }),
      makeRepo({ id: 'c', name: 'bad name!', selected: true }),
    ]
    const plan = buildDeterministicPlan(repos, { azureProject: 'X', conflicts: {}, allRepos: repos })
    expect(plan).toEqual([
      { repoIndex: 0, type: 'reserved-name', from: 'api', to: 'api-repo', reason: expect.any(String) },
      { repoIndex: 2, type: 'invalid-chars', from: 'bad name!', to: 'bad-name-', reason: expect.any(String) },
    ])
  })
})
