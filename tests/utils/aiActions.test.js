import { describe, it, expect, vi } from 'vitest'
import {
  AI_ACTIONS,
  AI_ACTION_TYPES,
  validateAction,
  sanitizeActions,
  dispatchAction,
} from '../../src/utils/aiActions'

describe('aiActions registry', () => {
  it('exposes exactly the five v1 actions', () => {
    expect(AI_ACTION_TYPES.sort()).toEqual([
      'open_create_repo',
      'open_migration_history',
      'open_migration_wizard',
      'open_settings',
      'open_transfer',
    ])
  })

  it('every action maps to a real ModalContext name', () => {
    const VALID_MODALS = new Set([
      'showCreateRepo', 'showTransfer', 'showOrgManager', 'showDevToolkit',
      'showRepoInsights', 'showCommunityHealth', 'showSettings',
      'showMigrationWizard', 'showMigrationHistory', 'showConfirm',
      'showBatchIndex', 'showCompare', 'showSecurityScan', 'showLicenseActivation',
    ])
    for (const type of AI_ACTION_TYPES) {
      expect(VALID_MODALS.has(AI_ACTIONS[type].modal)).toBe(true)
    }
  })
})

describe('validateAction', () => {
  it('accepts a known action and preserves custom label', () => {
    expect(validateAction({ type: 'open_migration_wizard', label: 'Migrar agora' }))
      .toEqual({ type: 'open_migration_wizard', label: 'Migrar agora' })
  })

  it('falls back to defaultLabel when label is missing or blank', () => {
    expect(validateAction({ type: 'open_settings' }))
      .toEqual({ type: 'open_settings', label: 'Open Settings' })
    expect(validateAction({ type: 'open_settings', label: '   ' }))
      .toEqual({ type: 'open_settings', label: 'Open Settings' })
  })

  it('rejects unknown action types', () => {
    expect(validateAction({ type: 'delete_repo', label: 'bad' })).toBeNull()
    expect(validateAction({ type: 'open_migration_wizard ', label: 'x' })).toBeNull()
  })

  it('rejects non-object input', () => {
    expect(validateAction(null)).toBeNull()
    expect(validateAction(undefined)).toBeNull()
    expect(validateAction('open_settings')).toBeNull()
    expect(validateAction(42)).toBeNull()
  })
})

describe('sanitizeActions', () => {
  it('returns empty array for non-arrays', () => {
    expect(sanitizeActions(null)).toEqual([])
    expect(sanitizeActions({})).toEqual([])
    expect(sanitizeActions(undefined)).toEqual([])
  })

  it('filters invalid entries and dedupes by type', () => {
    const raw = [
      { type: 'open_settings' },
      { type: 'bad_action', label: 'x' },
      { type: 'open_settings', label: 'Duplicate' },
      { type: 'open_migration_wizard', label: 'Migrate' },
    ]
    expect(sanitizeActions(raw)).toEqual([
      { type: 'open_settings', label: 'Open Settings' },
      { type: 'open_migration_wizard', label: 'Migrate' },
    ])
  })
})

describe('dispatchAction', () => {
  it('calls openModal with the matching modal name and returns true', () => {
    const openModal = vi.fn()
    const result = dispatchAction(
      { type: 'open_migration_wizard', label: 'Go' },
      { openModal }
    )
    expect(openModal).toHaveBeenCalledWith('showMigrationWizard')
    expect(result).toBe(true)
  })

  it('no-ops and returns false for unknown action', () => {
    const openModal = vi.fn()
    const result = dispatchAction({ type: 'nuke_everything' }, { openModal })
    expect(openModal).not.toHaveBeenCalled()
    expect(result).toBe(false)
  })
})
