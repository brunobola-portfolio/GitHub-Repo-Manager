import { describe, it, expect } from 'vitest'
import { evaluateRepo, RESERVED_NAMES } from '../../../../../src/components/MigrationWizard/steps/RepoSelectStep/riskRules'
import { makeRepo } from './fixtures.js'

const base = {
  id: 'r1', name: 'foo', size: 1024, branches: 2, isDisabled: false,
  isTfvc: false, lastCommitDate: new Date().toISOString(), hasLfsMarker: false,
}
const ctx = { allRepos: [base], conflicts: {}, targetOrg: 'acme' }

describe('risk engine', () => {
  it('returns ok when no flags', () => {
    const r = evaluateRepo(base, ctx)
    expect(r.level).toBe('ok')
    expect(r.flags).toEqual([])
  })

  it('flags archived as info', () => {
    const r = evaluateRepo({ ...base, isDisabled: true }, ctx)
    expect(r.level).toBe('info')
    expect(r.flags[0].type).toBe('archived')
  })

  it('flags size > 5GB as warning', () => {
    // size is in bytes (matches Azure DevOps GitRepository.size)
    const r = evaluateRepo({ ...base, size: 6 * 1024 * 1024 * 1024 }, ctx)
    expect(r.level).toBe('warning')
    expect(r.flags.some((f) => f.type === 'size-warning')).toBe(true)
  })

  it('flags size > 10GB as blocker', () => {
    const r = evaluateRepo({ ...base, size: 11 * 1024 * 1024 * 1024 }, ctx)
    expect(r.level).toBe('blocker')
    expect(r.flags.some((f) => f.type === 'size-critical')).toBe(true)
  })

  it('clears size-critical when sizeStrategy=lfs-migrate is chosen', () => {
    const r = evaluateRepo(
      { ...base, size: 11 * 1024 * 1024 * 1024, sizeStrategy: 'lfs-migrate' },
      ctx,
    )
    expect(r.flags.some((f) => f.type === 'size-critical')).toBe(false)
    expect(r.level).not.toBe('blocker')
  })

  it('clears size-critical when sizeStrategy=exclude is chosen', () => {
    const r = evaluateRepo(
      { ...base, size: 11 * 1024 * 1024 * 1024, sizeStrategy: 'exclude' },
      ctx,
    )
    expect(r.flags.some((f) => f.type === 'size-critical')).toBe(false)
    expect(r.level).not.toBe('blocker')
  })

  it('flags name conflict as blocker', () => {
    const r = evaluateRepo(base, { ...ctx, conflicts: { foo: true } })
    expect(r.level).toBe('blocker')
    expect(r.flags.some((f) => f.type === 'name-conflict')).toBe(true)
  })

  it('does NOT flag name conflict when target exists but is empty', () => {
    // Server marks duplicates[name]=false when target is empty; the risk
    // engine should mirror that and emit only the informative reuse flag.
    const r = evaluateRepo(base, {
      ...ctx,
      conflicts: { foo: false },
      conflictDetails: { foo: { exists: true, empty: true } },
    })
    expect(r.flags.some((f) => f.type === 'name-conflict')).toBe(false)
    expect(r.flags.some((f) => f.type === 'empty-target-reuse')).toBe(true)
    expect(r.level).not.toBe('blocker')
  })

  it('does not surface empty-target-reuse when target does not exist', () => {
    const r = evaluateRepo(base, {
      ...ctx,
      conflictDetails: { foo: { exists: false, empty: false } },
    })
    expect(r.flags.some((f) => f.type === 'empty-target-reuse')).toBe(false)
  })

  it('flags stale repo (>2 years) as info', () => {
    const old = new Date(Date.now() - 3 * 365 * 86400_000).toISOString()
    const r = evaluateRepo({ ...base, lastCommitDate: old }, ctx)
    expect(r.flags.some((f) => f.type === 'stale')).toBe(true)
    expect(r.level).toBe('info')
  })

  it('flags empty repo as info', () => {
    const r = evaluateRepo({ ...base, size: 0, branches: 0 }, ctx)
    expect(r.flags.some((f) => f.type === 'empty')).toBe(true)
  })

  it('flags LFS marker without explicit opt-in as warning', () => {
    const r = evaluateRepo({ ...base, hasLfsMarker: true, lfsEnabled: false }, ctx)
    expect(r.flags.some((f) => f.type === 'lfs-suggested')).toBe(true)
  })

  it('flags invalid chars as blocker', () => {
    const r = evaluateRepo({ ...base, name: 'has space!' }, ctx)
    expect(r.flags.some((f) => f.type === 'invalid-chars')).toBe(true)
    expect(r.level).toBe('blocker')
  })

  it('flags reserved names as blocker', () => {
    for (const name of RESERVED_NAMES) {
      const r = evaluateRepo({ ...base, name }, ctx)
      expect(r.flags.some((f) => f.type === 'reserved-name')).toBe(true)
    }
  })

  it('flags duplicate target names in batch as blocker (only when both selected)', () => {
    const selectedDupes = [
      { ...base, id: 'a', name: 'dup', selected: true },
      { ...base, id: 'b', name: 'dup', selected: true },
    ]
    const r = evaluateRepo(selectedDupes[0], { ...ctx, allRepos: selectedDupes })
    expect(r.flags.some((f) => f.type === 'duplicate-in-batch')).toBe(true)
  })

  it('does not flag duplicate-in-batch when either dupe is unselected', () => {
    const mixed = [
      { ...base, id: 'a', name: 'dup', selected: true },
      { ...base, id: 'b', name: 'dup', selected: false },
    ]
    const r = evaluateRepo(mixed[0], { ...ctx, allRepos: mixed })
    expect(r.flags.some((f) => f.type === 'duplicate-in-batch')).toBe(false)
  })
})

describe('riskRules effective-name resolution', () => {
  it('ruleInvalidChars: clears when targetName is valid even if name is invalid', () => {
    const repo = makeRepo({ name: 'bad name!', targetName: 'good-name' })
    const { flags } = evaluateRepo(repo, { allRepos: [repo] })
    expect(flags.some(f => f.type === 'invalid-chars')).toBe(false)
  })

  it('ruleInvalidChars: still fires when targetName is also invalid', () => {
    const repo = makeRepo({ name: 'bad name!', targetName: 'still bad!' })
    const { flags } = evaluateRepo(repo, { allRepos: [repo] })
    expect(flags.some(f => f.type === 'invalid-chars')).toBe(true)
  })

  it('ruleReservedName: clears when targetName is not reserved', () => {
    const repo = makeRepo({ name: 'api', targetName: 'api-repo' })
    const { flags } = evaluateRepo(repo, { allRepos: [repo] })
    expect(flags.some(f => f.type === 'reserved-name')).toBe(false)
  })

  it('ruleDuplicateInBatch: evaluates effective names across selected repos', () => {
    const a = makeRepo({ id: 'a', name: 'dup', targetName: 'dup-a' })
    const b = makeRepo({ id: 'b', name: 'dup', targetName: 'dup-b' })
    const ctxA = { allRepos: [a, b] }
    const ctxB = { allRepos: [a, b] }
    expect(evaluateRepo(a, ctxA).flags.some(f => f.type === 'duplicate-in-batch')).toBe(false)
    expect(evaluateRepo(b, ctxB).flags.some(f => f.type === 'duplicate-in-batch')).toBe(false)
  })

  it('ruleNameConflict: clears when targetName avoids the target-org collision', () => {
    const repo = makeRepo({ name: 'existing', targetName: 'existing-new' })
    const conflictCtx = { conflicts: { existing: true }, allRepos: [repo] }
    const { flags } = evaluateRepo(repo, conflictCtx)
    expect(flags.some(f => f.type === 'name-conflict')).toBe(false)
  })

  it('falls back to name when targetName is empty string', () => {
    const repo = makeRepo({ name: 'my-repo', targetName: '' })
    const { flags } = evaluateRepo(repo, { allRepos: [repo] })
    expect(flags.some(f => f.type === 'invalid-chars')).toBe(false)
  })

  it('falls back to name when targetName is whitespace-only', () => {
    const repo = makeRepo({ name: 'my-repo', targetName: '   ' })
    const { flags } = evaluateRepo(repo, { allRepos: [repo] })
    expect(flags.some(f => f.type === 'invalid-chars')).toBe(false)
  })
})
