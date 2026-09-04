import { useEffect, useState, useCallback, useRef } from 'react'
import { GLOBAL_SHORTCUTS, NAVIGATION_CHORDS, getAllShortcuts } from '../config/keyboardShortcuts'

// Prefix key for the Linear/Gmail-style navigation chord (`g` then a
// second key within CHORD_TIMEOUT_MS). Kept as a constant rather than
// reading NAVIGATION_CHORDS[0].keys[0] so the intent reads at the call site.
const CHORD_PREFIX = 'g'
const CHORD_TIMEOUT_MS = 800

/**
 * Action handler dispatch — keys must match the `action` field in
 * GLOBAL_SHORTCUTS / NAVIGATION_CHORDS entries. Adding a new global
 * shortcut or chord means appending to the catalog *and* this map (the
 * test in keyboardShortcuts.test.js cross-checks that every action key has
 * a non-empty handler).
 */
function buildHandlerMap({ onSearch, onCreateRepo, onMigrate, onViewChange, onOpenDevToolkit, toggleHelp }) {
    return {
        searchFocus: onSearch,
        createRepo: onCreateRepo,
        migrate: onMigrate,
        openDevToolkit: onOpenDevToolkit,
        showHelp: toggleHelp,
        navDashboard: () => onViewChange?.('dashboard'),
        navRepos: () => onViewChange?.('repos'),
        navWorkBoard: () => onViewChange?.('work-board'),
        navTeams: () => onViewChange?.('teams'),
        navPricing: () => onViewChange?.('pricing'),
    }
}

export function useKeyboardShortcuts({
    onSearch,
    onCreateRepo,
    onMigrate,
    onViewChange,
    onOpenDevToolkit,
    enabled = true
}) {
    const [showHelp, setShowHelp] = useState(false)
    const lastExecutionRef = useRef(0)
    // { active, timer } — `g` arms this for CHORD_TIMEOUT_MS; the next
    // keydown (matching chord or not) always clears it. A ref rather than
    // state: the chord window shouldn't cause a re-render, and reading it
    // synchronously inside the same keydown handler that sets it needs no
    // stale-closure workaround the way state would.
    const chordRef = useRef({ active: false, timer: null })
    const toggleHelp = useCallback(() => setShowHelp(prev => !prev), [])

    const clearChord = useCallback(() => {
        if (chordRef.current.timer) clearTimeout(chordRef.current.timer)
        chordRef.current = { active: false, timer: null }
    }, [])

    const handleKeyDown = useCallback((e) => {
        if (!enabled) return

        const chordPending = chordRef.current.active

        // Debounce: prevent double-trigger on rapid keypress (exempt Escape
        // and a pending chord's second keystroke — a deliberate "g d" can
        // legitimately land under 100ms apart for a fast typist, and the
        // debounce would otherwise eat the follow key).
        const now = Date.now()
        if (e.key !== 'Escape' && !chordPending && now - lastExecutionRef.current < 100) return
        lastExecutionRef.current = now

        // Don't trigger if user is typing in an input, textarea, or contentEditable
        const target = e.target
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return
        }

        // Escape closes the help modal regardless of modifier state
        if (e.key === 'Escape' && showHelp) {
            e.preventDefault()
            setShowHelp(false)
            return
        }

        // Don't trigger with modifier keys (except shift for ?)
        if (e.ctrlKey || e.metaKey || e.altKey) return

        const handlers = buildHandlerMap({ onSearch, onCreateRepo, onMigrate, onViewChange, onOpenDevToolkit, toggleHelp })

        // Chord layer: `g` arms a ~800ms window for a second keystroke. A
        // match navigates; anything else — a non-matching key, a second
        // `g`, or the window elapsing — just cancels the chord. It never
        // falls through to a single-key dispatch, so a mistyped chord
        // can't misfire an unrelated shortcut.
        if (chordPending) {
            clearChord()
            const chord = NAVIGATION_CHORDS.find(c => c.keys[0] === CHORD_PREFIX && c.keys[1] === e.key)
            if (chord && handlers[chord.action]) {
                e.preventDefault()
                handlers[chord.action]()
            }
            return
        }

        if (e.key === CHORD_PREFIX) {
            e.preventDefault()
            chordRef.current = {
                active: true,
                timer: setTimeout(clearChord, CHORD_TIMEOUT_MS),
            }
            return
        }

        const match = GLOBAL_SHORTCUTS.find(s => s.key === e.key)
        if (match && handlers[match.action]) {
            e.preventDefault()
            handlers[match.action]()
        }
    }, [enabled, onSearch, onCreateRepo, onMigrate, onViewChange, onOpenDevToolkit, showHelp, toggleHelp, clearChord])

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            clearChord()
        }
    }, [handleKeyDown, clearChord])

    // Help dialog pulls from the canonical catalog (global + chords + every
    // other surface's documented-only shortcuts). The hook itself executes
    // only GLOBAL_SHORTCUTS and NAVIGATION_CHORDS; everything else is
    // documented here but executed by its own surface.
    return { showHelp, setShowHelp, shortcuts: getAllShortcuts() }
}

/**
 * Register a single-key shortcut scoped to the current view.
 * Ignores keystrokes while typing in inputs or when a modifier is held.
 */
export function useContextShortcut({ key, handler, when = true, deps = [] }) {
    // Keep the latest handler in a ref so the listener always calls the current
    // closure — without this, an inline handler captured on first registration
    // goes stale (the effect re-runs only on key/when/deps changes).
    const handlerRef = useRef(handler)
    useEffect(() => { handlerRef.current = handler })
    useEffect(() => {
        if (!when) return undefined
        function h(e) {
            const tag = (e.target?.tagName || '').toLowerCase()
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
            if (e.metaKey || e.ctrlKey || e.altKey) return
            if (e.key === key) {
                e.preventDefault()
                handlerRef.current(e)
            }
        }
        window.addEventListener('keydown', h)
        return () => window.removeEventListener('keydown', h)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- deps still re-bind on caller-provided values; handler stays fresh via ref
    }, [key, when, ...deps])
}
