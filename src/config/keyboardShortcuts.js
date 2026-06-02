/*
 * Centralised keyboard-shortcut catalog.
 *
 * Was previously hardcoded inside `src/hooks/useKeyboardShortcuts.js`, which
 * coupled the hook (execution-time concerns: debounce, modifier guards,
 * input-focus checks) with the catalog (UX-time concerns: which keys do
 * what, what's the description). Splitting them lets:
 *
 *  1. the help modal pull from a single source — no risk of drift between
 *     "what runs" and "what's documented".
 *  2. action registries (repoActions / future PR/branch/issue registries)
 *     contribute their own shortcuts via `collectRegistryShortcuts()`.
 *
 * The hook iterates this list and dispatches to the appropriate handler
 * based on the `action` key (a declarative reference, not a function ref —
 * function refs would defeat the centralisation since callers wire them
 * up themselves).
 */

import { repoActions } from '../actions/repoActions'

/**
 * @typedef {Object} KeyboardShortcut
 * @property {string} key                       — single key (a-z, ?, /, etc.) or 'Shift+X'
 * @property {string} description               — human-readable label for the help modal
 * @property {'global'|'navigation'|'repo-action'} scope
 * @property {string} [action]                  — handler-map key the hook dispatches on
 * @property {string} [actionId]                — for scope:'repo-action', the registry id
 */

/**
 * Global / navigation shortcuts. The `action` field is a declarative
 * reference resolved by the hook's handler map — adding a new entry here
 * also requires adding the matching handler to the hook's switch.
 *
 * @type {KeyboardShortcut[]}
 */
export const GLOBAL_SHORTCUTS = Object.freeze([
    { key: '/', description: 'Focus search', scope: 'global', action: 'searchFocus' },
    { key: 'n', description: 'Create new repository', scope: 'global', action: 'createRepo' },
    { key: 'i', description: 'Open Migration Wizard', scope: 'global', action: 'migrate' },
    { key: 'g', description: 'Open Dev Toolkit', scope: 'global', action: 'openDevToolkit' },
    { key: '?', description: 'Show shortcuts help', scope: 'global', action: 'showHelp' },
    { key: 'd', description: 'Go to Dashboard', scope: 'navigation', action: 'navDashboard' },
    { key: 'r', description: 'Go to Repositories', scope: 'navigation', action: 'navRepos' },
    { key: 't', description: 'Go to Teams', scope: 'navigation', action: 'navTeams' },
])

/**
 * Shortcuts owned by dedicated surfaces (the command palette and the Live
 * Inbox) rather than the global hook. Listed here purely so the help modal
 * documents them — they carry no `action`, and the hook iterates
 * GLOBAL_SHORTCUTS (not this list), so nothing is double-bound.
 *
 * @type {KeyboardShortcut[]}
 */
export const DOCS_ONLY_SHORTCUTS = Object.freeze([
    { key: 'Ctrl+K', description: 'Open command palette', scope: 'global' },
    { key: 'e', description: 'Archive top item (Live Inbox)', scope: 'inbox' },
    { key: 's', description: 'Snooze top item (Live Inbox)', scope: 'inbox' },
])

/**
 * Walks the action registries and emits their `keyboardShortcut` declarations
 * so the help modal can document them alongside the global ones. Execution
 * of repo-scoped shortcuts is the consuming surface's responsibility (a
 * shortcut on `delete` needs a focused repo target — the global hook
 * doesn't have that context).
 *
 * Returns an empty array today; the field is reserved for future wiring.
 *
 * @returns {KeyboardShortcut[]}
 */
export function collectRegistryShortcuts() {
    const out = []
    for (const action of Object.values(repoActions)) {
        if (!action.keyboardShortcut) continue
        const ks = action.keyboardShortcut
        out.push({
            key: ks.key,
            description: ks.description ?? (typeof action.label === 'string' ? action.label : action.id),
            scope: 'repo-action',
            actionId: action.id,
        })
    }
    return out
}

/**
 * Canonical list consumed by the help modal. Hook callers use
 * `GLOBAL_SHORTCUTS` directly since registry-scoped shortcuts need different
 * dispatch.
 *
 * @returns {KeyboardShortcut[]}
 */
export function getAllShortcuts() {
    return [...GLOBAL_SHORTCUTS, ...DOCS_ONLY_SHORTCUTS, ...collectRegistryShortcuts()]
}
