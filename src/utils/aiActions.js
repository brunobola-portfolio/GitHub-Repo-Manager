/**
 * AI action catalog.
 *
 * Each entry describes how to dispatch a whitelisted action:
 * - `modal` (string): name passed to `openModal` for modal-opening actions.
 * - `event` (string): DOM custom event name for navigation actions that need
 *   App-level state (e.g. selecting a repo + switching the active tab).
 * - `payloadShape` (object): per-key validators for the optional payload.
 *   Only keys listed here are forwarded; unknown keys are dropped silently
 *   so a hallucinated `description: '...'` never reaches the dispatcher.
 */
import { emitAppEvent, APP_EVENTS } from './appEvents'

export const AI_ACTIONS = {
  open_migration_wizard: {
    modal: 'showMigrationWizard',
    defaultLabel: 'Open Migration Wizard',
  },
  open_migration_history: {
    modal: 'showMigrationHistory',
    defaultLabel: 'View Migration History',
  },
  open_create_repo: {
    modal: 'showCreateRepo',
    defaultLabel: 'Create Repository',
  },
  open_transfer: {
    modal: 'showTransfer',
    defaultLabel: 'Transfer Repository',
  },
  open_settings: {
    modal: 'showSettings',
    defaultLabel: 'Open Settings',
  },
  open_repo_settings: {
    event: APP_EVENTS.OPEN_REPO_SETTINGS,
    defaultLabel: 'Open Repo Settings',
    payloadShape: {
      owner: (v) => typeof v === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(v),
      repo: (v) => typeof v === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(v),
    },
  },
  open_ai_polish: {
    event: APP_EVENTS.OPEN_AI_POLISH,
    defaultLabel: 'Polish repos with AI',
    payloadShape: {
      repoFullNames: (v) => Array.isArray(v)
        && v.length > 0
        && v.length <= 50
        && v.every(s => typeof s === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)),
    },
  },
}

export const AI_ACTION_TYPES = Object.keys(AI_ACTIONS)

function validatePayload(entry, candidatePayload) {
  if (!entry.payloadShape) return undefined
  if (!candidatePayload || typeof candidatePayload !== 'object') return undefined
  const out = {}
  for (const [key, check] of Object.entries(entry.payloadShape)) {
    const value = candidatePayload[key]
    if (value !== undefined && check(value)) out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

export function validateAction(candidate) {
  if (!candidate || typeof candidate !== 'object') return null
  const entry = AI_ACTIONS[candidate.type]
  if (!entry) return null
  const label = typeof candidate.label === 'string' && candidate.label.trim()
    ? candidate.label.trim()
    : entry.defaultLabel
  const payload = validatePayload(entry, candidate.payload)
  const validated = { type: candidate.type, label }
  if (payload) validated.payload = payload
  return validated
}

export function sanitizeActions(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const result = []
  for (const item of raw) {
    const valid = validateAction(item)
    if (!valid) continue
    if (seen.has(valid.type)) continue
    seen.add(valid.type)
    result.push(valid)
  }
  return result
}

export function dispatchAction(action, { openModal } = {}) {
  const validated = validateAction(action)
  if (!validated) return false
  const entry = AI_ACTIONS[validated.type]
  if (entry.modal && openModal) {
    openModal(entry.modal)
    return true
  }
  if (entry.event) {
    emitAppEvent(entry.event, validated.payload || {})
    return true
  }
  return false
}
