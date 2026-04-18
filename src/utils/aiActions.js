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
}

export const AI_ACTION_TYPES = Object.keys(AI_ACTIONS)

export function validateAction(candidate) {
  if (!candidate || typeof candidate !== 'object') return null
  const entry = AI_ACTIONS[candidate.type]
  if (!entry) return null
  const label = typeof candidate.label === 'string' && candidate.label.trim()
    ? candidate.label.trim()
    : entry.defaultLabel
  return { type: candidate.type, label }
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

export function dispatchAction(action, { openModal }) {
  const validated = validateAction(action)
  if (!validated) return false
  const entry = AI_ACTIONS[validated.type]
  openModal(entry.modal)
  return true
}
