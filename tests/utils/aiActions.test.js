import { describe, it, expect, vi } from 'vitest'
import {
  AI_ACTIONS,
  AI_ACTION_TYPES,
  validateAction,
  sanitizeActions,
  dispatchAction,
} from '../../src/utils/aiActions'

describe('aiActions registry', () => {
  it('exposes the whitelisted actions', () => {
    expect(AI_ACTION_TYPES.sort()).toEqual([
      'open_ai_polish',
      'open_create_repo',
      'open_migration_history',
      'open_migration_wizard',
      'open_repo_settings',
      'open_settings',
      'open_transfer',
    ])
  })

  it('every action has either a modal name or an event name', () => {
    const VALID_MODALS = new Set([
      'showCreateRepo', 'showTransfer', 'showOrgManager', 'showDevToolkit',
      'showRepoInsights', 'showCommunityHealth', 'showSettings',
      'showMigrationWizard', 'showMigrationHistory', 'showConfirm',
      'showBatchIndex', 'showCompare', 'showSecurityScan', 'showLicenseActivation',
    ])
    for (const type of AI_ACTION_TYPES) {
      const entry = AI_ACTIONS[type]
      const valid = (entry.modal && VALID_MODALS.has(entry.modal))
        || (entry.event && entry.event.startsWith('app:'))
      expect(valid).toBe(true)
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

  it('dispatches event-based actions via window CustomEvent with validated payload', () => {
    const handler = vi.fn()
    window.addEventListener('app:open-repo-settings', handler)
    const result = dispatchAction(
      { type: 'open_repo_settings', label: 'Open settings', payload: { owner: 'alice', repo: 'demo' } },
      { openModal: vi.fn() }
    )
    expect(result).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].detail).toEqual({ owner: 'alice', repo: 'demo' })
    window.removeEventListener('app:open-repo-settings', handler)
  })

  it('drops invalid payload fields silently before dispatching', () => {
    const handler = vi.fn()
    window.addEventListener('app:open-repo-settings', handler)
    dispatchAction(
      { type: 'open_repo_settings', payload: { owner: 'alice', repo: 'demo', extra: 'evil', description: 'hijack' } },
      { openModal: vi.fn() }
    )
    expect(handler.mock.calls[0][0].detail).toEqual({ owner: 'alice', repo: 'demo' })
    window.removeEventListener('app:open-repo-settings', handler)
  })

  it('rejects payload with malformed owner/repo (script tags, slashes)', () => {
    const validated = validateAction({
      type: 'open_repo_settings',
      payload: { owner: '<script>', repo: 'a/b' },
    })
    // Both fields are invalid → no payload survives → action keeps default label only.
    expect(validated.payload).toBeUndefined()
  })
})
