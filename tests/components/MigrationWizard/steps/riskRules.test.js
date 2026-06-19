import { describe, it, expect } from 'vitest'
import { evaluateRepo } from '../../../../src/components/MigrationWizard/steps/RepoSelectStep/riskRules'

const ctx = (over = {}) => ({ conflicts: { AITOOL: true }, conflictDetails: {}, targetOrg: 'BolaLabs', allRepos: [], ...over })
const repo = (over = {}) => ({ name: 'AITOOL', selected: true, size: 100, branches: 1, ...over })

describe('name-conflict resolution', () => {
  it('is a blocker with replace/rename/skip actions when unresolved', () => {
    const r = evaluateRepo(repo(), ctx())
    const f = r.flags.find((x) => x.type === 'name-conflict')
    expect(f.severity).toBe('blocker')
    expect(f.actions.map((a) => a.id)).toEqual(['replace', 'rename', 'skip'])
  })

  it('downgrades to info (no blocker) once conflictAction is replace', () => {
    const r = evaluateRepo(repo({ conflictAction: 'replace' }), ctx())
    expect(r.flags.some((f) => f.severity === 'blocker')).toBe(false)
    const f = r.flags.find((x) => x.type === 'will-replace')
    expect(f.severity).toBe('info')
    expect(f.actions.map((a) => a.id)).toEqual(['undo-replace'])
  })

  it('clears entirely when renamed to a free name', () => {
    const r = evaluateRepo(repo({ targetName: 'AITOOL-migrated', conflictAction: 'rename' }), ctx())
    expect(r.flags.some((f) => f.type === 'name-conflict' || f.type === 'will-replace')).toBe(false)
  })
})
