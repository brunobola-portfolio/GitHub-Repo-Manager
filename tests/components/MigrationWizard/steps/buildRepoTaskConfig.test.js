import { describe, it, expect } from 'vitest'
import { buildRepoTaskConfig } from '../../../../src/components/MigrationWizard/steps/buildRepoTaskConfig'

describe('buildRepoTaskConfig', () => {
  it('builds base config (visibility + description)', () => {
    const cfg = buildRepoTaskConfig(
      { visibility: 'private', description: 'hi' },
      { isInPlace: false, targetProject: '' },
    )
    expect(cfg).toEqual({ makePrivate: true, description: 'hi' })
  })

  it('adds onConflict only when conflictAction is replace', () => {
    expect(buildRepoTaskConfig({ visibility: 'public', conflictAction: 'replace' }, { isInPlace: false }))
      .toMatchObject({ onConflict: 'replace' })
    expect(buildRepoTaskConfig({ visibility: 'public', conflictAction: 'rename' }, { isInPlace: false }))
      .not.toHaveProperty('onConflict')
    expect(buildRepoTaskConfig({ visibility: 'public' }, { isInPlace: false }))
      .not.toHaveProperty('onConflict')
  })

  it('keeps lfs-migrate sizeStrategy', () => {
    expect(buildRepoTaskConfig({ visibility: 'private', sizeStrategy: 'lfs-migrate' }, { isInPlace: false }))
      .toMatchObject({ sizeStrategy: 'lfs-migrate' })
  })

  it('adds in-place fields for TFVC existing-empty', () => {
    const cfg = buildRepoTaskConfig(
      { visibility: 'private', isTfvc: true, targetType: 'existing-empty', existingRepoId: 'abc' },
      { isInPlace: true, targetProject: 'Proj' },
    )
    expect(cfg).toMatchObject({ inPlace: true, targetProject: 'Proj', existingRepoId: 'abc' })
  })
})
