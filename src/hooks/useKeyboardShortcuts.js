import { useEffect, useState, useCallback, useRef } from 'react'
import { GLOBAL_SHORTCUTS, getAllShortcuts } from '../config/keyboardShortcuts'

/**
 * Action handler dispatch — keys must match the `action` field in
 * GLOBAL_SHORTCUTS entries. Adding a new global shortcut means appending
 * to GLOBAL_SHORTCUTS *and* this map (the test in keyboardShortcuts.test.js
 * cross-checks that every action key has a non-empty handler).
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
        navTeams: () => onViewChange?.('teams'),
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
    const toggleHelp = useCallback(() => setShowHelp(prev => !prev), [])

    const handleKeyDown = useCallback((e) => {
        if (!enabled) return

        // Debounce: prevent double-trigger on rapid keypress (exempt Escape)
        const now = Date.now()
        if (e.key !== 'Escape' && now - lastExecutionRef.current < 100) return
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
        const match = GLOBAL_SHORTCUTS.find(s => s.key === e.key)
        if (match && handlers[match.action]) {
            e.preventDefault()
            handlers[match.action]()
        }
    }, [enabled, onSearch, onCreateRepo, onMigrate, onViewChange, onOpenDevToolkit, showHelp, toggleHelp])

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])

    // Help modal pulls from the canonical catalog (global + any
    // registry-declared shortcuts). The hook itself executes only the
    // global ones; repo-scoped shortcuts need a focused-repo target so
    // they're documented but executed by their consuming surface.
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
