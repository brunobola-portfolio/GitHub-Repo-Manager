/*
 * Centralised keyboard-shortcut catalog — the single source of truth for
 * every keyboard surface in the app (global hook, Work Board, PR Review,
 * the Migration Wizard's repo-select step, and the repos/inbox row
 * navigation added alongside the Work Board's). Was previously hardcoded
 * inside `src/hooks/useKeyboardShortcuts.js`, which coupled the hook
 * (execution-time concerns: debounce, modifier guards, input-focus checks)
 * with the catalog (UX-time concerns: which keys do what, what's the
 * description). Splitting them lets:
 *
 *  1. one help dialog (`KeyboardShortcutsHelp`) render every surface's
 *     shortcuts from `scope` — no risk of drift between "what runs" and
 *     "what's documented", and no per-surface `<kbd>` reinvention.
 *  2. action registries (repoActions / future PR/branch/issue registries)
 *     contribute their own shortcuts via `collectRegistryShortcuts()`.
 *
 * The hook iterates GLOBAL_SHORTCUTS / NAVIGATION_CHORDS and dispatches to
 * the appropriate handler based on the `action` key (a declarative
 * reference, not a function ref — function refs would defeat the
 * centralisation since callers wire them up themselves). Every other
 * export here (DOCS_ONLY_SHORTCUTS, WORKBOARD_SHORTCUTS,
 * PRREVIEW_SHORTCUTS, WIZARD_SHORTCUTS) documents shortcuts that are
 * EXECUTED by their own surface (WorkBoardPage, PRReviewView, RepoGrid +
 * useFocusedRow, useInbox, the wizard's RepoSelectStep) — the global hook
 * never dispatches them, it only lists them for the help dialog.
 */

import { repoActions } from '../actions/repoActions'

/**
 * @typedef {Object} KeyboardShortcut
 * @property {string} [key]      — single key for a one-binding entry (a-z, ?, /, Enter, Esc, …)
 * @property {string[]} [keys]   — ordered key sequence for display (and, for
 *                                 NAVIGATION_CHORDS, execution): a chord like
 *                                 ['g','d'] or a modifier combo like
 *                                 ['Ctrl','Shift','A']. Renderers use
 *                                 `keys ?? [key]`.
 * @property {string} description
 * @property {'global'|'navigation'|'repos'|'inbox'|'workBoard'|'prReview'|'wizard'} scope
 * @property {string} [section]  — heading for the help dialog; defaults to
 *                                 the scope's own label (see SCOPE_LABELS
 *                                 in KeyboardShortcutsHelp.jsx)
 * @property {string} [group]    — sub-heading within a section (e.g.
 *                                 'Navigate' / 'Actions') for surfaces that
 *                                 used to be their own modal with its own
 *                                 row groups
 * @property {string} [action]   — handler-map key the hook dispatches on
 *                                 (GLOBAL_SHORTCUTS / NAVIGATION_CHORDS only)
 * @property {string} [actionId] — for scope:'repos' registry-collected entries
 */

/**
 * Single-keystroke global shortcuts, dispatched directly by the hook on
 * keydown (no chord).
 *
 * @type {KeyboardShortcut[]}
 */
export const GLOBAL_SHORTCUTS = Object.freeze([
    { key: '/', description: 'Focus search', scope: 'global', section: 'General', action: 'searchFocus' },
    { key: 'n', description: 'Create new repository', scope: 'global', section: 'General', action: 'createRepo' },
    { key: 'i', description: 'Open Migration Wizard', scope: 'global', section: 'General', action: 'migrate' },
    { key: '`', description: 'Open Dev Toolkit', scope: 'global', section: 'General', action: 'openDevToolkit' },
    { key: '?', description: 'Show shortcuts help', scope: 'global', section: 'General', action: 'showHelp' },
])

/**
 * The Linear/Gmail-style `g` chord: press `g`, then a second key within the
 * hook's chord window, to navigate. Kept separate from GLOBAL_SHORTCUTS
 * because the hook's dispatch logic for a two-keystroke sequence is
 * genuinely different (it needs the pending-chord state machine), not just
 * a different key. `keys[0]` is always the chord prefix and `keys[1]` the
 * follow key — the hook reads both; the help dialog renders both as
 * separate <Kbd> chips.
 *
 * @type {KeyboardShortcut[]}
 */
export const NAVIGATION_CHORDS = Object.freeze([
    { keys: ['g', 'd'], description: 'Go to Dashboard', scope: 'navigation', section: 'Navigation', action: 'navDashboard' },
    { keys: ['g', 'r'], description: 'Go to Repositories', scope: 'navigation', section: 'Navigation', action: 'navRepos' },
    { keys: ['g', 'w'], description: 'Go to Work Board', scope: 'navigation', section: 'Navigation', action: 'navWorkBoard' },
    { keys: ['g', 't'], description: 'Go to Teams', scope: 'navigation', section: 'Navigation', action: 'navTeams' },
    { keys: ['g', 'p'], description: 'Go to Pricing', scope: 'navigation', section: 'Navigation', action: 'navPricing' },
])

/**
 * Shortcuts owned and EXECUTED by other surfaces rather than the global
 * hook — listed here purely so the help dialog documents them. None carry
 * `action`, and the hook iterates GLOBAL_SHORTCUTS / NAVIGATION_CHORDS
 * (not these arrays), so nothing here is double-bound.
 *
 * @type {KeyboardShortcut[]}
 */
export const DOCS_ONLY_SHORTCUTS = Object.freeze([
    { key: 'Ctrl+K', description: 'Open command palette', scope: 'global', section: 'General' },

    // Repo grid/list — useFocusedRow mounted directly on RepoGrid.
    { key: 'j', description: 'Next repository', scope: 'repos', section: 'Repositories', group: 'Navigate' },
    { key: 'k', description: 'Previous repository', scope: 'repos', section: 'Repositories', group: 'Navigate' },
    { key: 'Enter', description: 'Open focused repository', scope: 'repos', section: 'Repositories', group: 'Navigate' },

    // Live Inbox — row nav lives inside useInbox; e/s live in InboxPanel.
    { key: 'j', description: 'Next item', scope: 'inbox', section: 'Live Inbox', group: 'Navigate' },
    { key: 'k', description: 'Previous item', scope: 'inbox', section: 'Live Inbox', group: 'Navigate' },
    { key: 'Enter', description: 'Open focused item', scope: 'inbox', section: 'Live Inbox', group: 'Navigate' },
    { key: 'e', description: 'Archive top item', scope: 'inbox', section: 'Live Inbox', group: 'Actions' },
    { key: 's', description: 'Snooze top item', scope: 'inbox', section: 'Live Inbox', group: 'Actions' },
])

/**
 * Work Board shortcuts (executed by WorkBoardPage / its tabs — see
 * `useFocusedRow`, `useContextShortcut({ key: '?' })`).
 *
 * @type {KeyboardShortcut[]}
 */
export const WORKBOARD_SHORTCUTS = Object.freeze([
    { key: 'j', description: 'Next row', scope: 'workBoard', section: 'Work Board', group: 'Navigate' },
    { key: 'k', description: 'Previous row', scope: 'workBoard', section: 'Work Board', group: 'Navigate' },
    { key: 'Enter', description: 'Open the active row on GitHub', scope: 'workBoard', section: 'Work Board', group: 'Navigate' },
    { key: '.', description: 'Approve (PR rows)', scope: 'workBoard', section: 'Work Board', group: 'Actions' },
    { key: 'x', description: 'Request changes (PR rows — opens prompt)', scope: 'workBoard', section: 'Work Board', group: 'Actions' },
    { key: 's', description: 'Snooze 24 h', scope: 'workBoard', section: 'Work Board', group: 'Actions' },
    { keys: ['Shift', 'S'], description: 'Snooze 7 d', scope: 'workBoard', section: 'Work Board', group: 'Actions' },
    { key: 'u', description: 'Unsnooze', scope: 'workBoard', section: 'Work Board', group: 'Actions' },
    { key: 'r', description: 'Re-request review', scope: 'workBoard', section: 'Work Board', group: 'Actions' },
    { key: '/', description: 'Focus filter search (when available)', scope: 'workBoard', section: 'Work Board', group: 'Global' },
    { key: '?', description: 'This help', scope: 'workBoard', section: 'Work Board', group: 'Global' },
    { key: 'Ctrl+K', description: 'Command palette', scope: 'workBoard', section: 'Work Board', group: 'Global' },
])

/**
 * PR Review shortcuts (executed by PRReviewView / useReviewKeyboard).
 *
 * @type {KeyboardShortcut[]}
 */
export const PRREVIEW_SHORTCUTS = Object.freeze([
    { key: 'j', description: 'Next file', scope: 'prReview', section: 'PR Review', group: 'Navigate' },
    { key: 'k', description: 'Previous file', scope: 'prReview', section: 'PR Review', group: 'Navigate' },
    { key: 'Esc', description: 'Close review / cancel composer', scope: 'prReview', section: 'PR Review', group: 'Navigate' },
    { key: 'x', description: 'Mark current file as reviewed', scope: 'prReview', section: 'PR Review', group: 'Review' },
    { keys: ['Ctrl', 'Shift', 'Enter'], description: 'Submit review (Approve / Comment / Request changes via UI)', scope: 'prReview', section: 'PR Review', group: 'Review' },
    { keys: ['Ctrl', 'Enter'], description: 'Submit inline comment', scope: 'prReview', section: 'PR Review', group: 'Diff' },
    { key: 'Esc', description: 'Cancel inline comment composer', scope: 'prReview', section: 'PR Review', group: 'Diff' },
    { key: '?', description: 'Show this overlay', scope: 'prReview', section: 'PR Review', group: 'Help' },
])

/**
 * Migration Wizard — repo select step shortcuts.
 *
 * @type {KeyboardShortcut[]}
 */
export const WIZARD_SHORTCUTS = Object.freeze([
    { key: '/', description: 'Focus search', scope: 'wizard', section: 'Repo Select' },
    { keys: ['↑', '↓'], description: 'Navigate rows', scope: 'wizard', section: 'Repo Select' },
    { key: 'Space', description: 'Toggle selection', scope: 'wizard', section: 'Repo Select' },
    { key: 'Enter', description: 'Open detail panel', scope: 'wizard', section: 'Repo Select' },
    { key: 'Esc', description: 'Close detail panel', scope: 'wizard', section: 'Repo Select' },
    { keys: ['J', 'K'], description: 'Prev/next in panel', scope: 'wizard', section: 'Repo Select' },
    { key: 'I', description: 'Invert selection', scope: 'wizard', section: 'Repo Select' },
    { keys: ['Ctrl', 'A'], description: 'Select all visible', scope: 'wizard', section: 'Repo Select' },
    { keys: ['Ctrl', 'Shift', 'A'], description: 'Deselect all', scope: 'wizard', section: 'Repo Select' },
    { key: '?', description: 'Show this help', scope: 'wizard', section: 'Repo Select' },
])

/**
 * Walks the action registries and emits their `keyboardShortcut` declarations
 * so the help dialog can document them alongside the built-in ones, grouped
 * under the Repositories section's "Actions" row group. Execution of
 * repo-scoped shortcuts is the consuming surface's responsibility (a
 * shortcut on `delete` needs a focused repo target — the global hook
 * doesn't have that context).
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
            scope: 'repos',
            section: 'Repositories',
            group: 'Actions',
            actionId: action.id,
        })
    }
    return out
}

/**
 * Canonical list consumed by the help dialog. Hook callers use
 * `GLOBAL_SHORTCUTS` / `NAVIGATION_CHORDS` directly since they need actual
 * dispatch, not just documentation.
 *
 * @returns {KeyboardShortcut[]}
 */
export function getAllShortcuts() {
    return [
        ...GLOBAL_SHORTCUTS,
        ...NAVIGATION_CHORDS,
        ...DOCS_ONLY_SHORTCUTS,
        ...WORKBOARD_SHORTCUTS,
        ...PRREVIEW_SHORTCUTS,
        ...WIZARD_SHORTCUTS,
        ...collectRegistryShortcuts(),
    ]
}
