import { describe, it, expect } from 'vitest'
import { evaluateRepo, RESERVED_NAMES } from '../../../../../src/components/MigrationWizard/steps/RepoSelectStep/riskRules'

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
    // size is in KB
    const r = evaluateRepo({ ...base, size: 6 * 1024 * 1024 }, ctx)
    expect(r.level).toBe('warning')
    expect(r.flags.some((f) => f.type === 'size-warning')).toBe(true)
  })

  it('flags size > 10GB as blocker', () => {
    const r = evaluateRepo({ ...base, size: 11 * 1024 * 1024 }, ctx)
    expect(r.level).toBe('blocker')
    expect(r.flags.some((f) => f.type === 'size-critical')).toBe(true)
  })

  it('flags name conflict as blocker', () => {
    const r = evaluateRepo(base, { ...ctx, conflicts: { foo: true } })
    expect(r.level).toBe('blocker')
    expect(r.flags.some((f) => f.type === 'name-conflict')).toBe(true)
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

  it('flags duplicate target names in batch as blocker', () => {
    const repos = [
      { ...base, id: 'a', name: 'dup' },
      { ...base, id: 'b', name: 'dup' },
    ]
    const r = evaluateRepo(repos[0], { ...ctx, allRepos: repos })
    expect(r.flags.some((f) => f.type === 'duplicate-in-batch')).toBe(true)
  })
})
