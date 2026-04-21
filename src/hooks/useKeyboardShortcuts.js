import { useEffect, useState, useCallback, useRef } from 'react'

const SHORTCUTS = [
    { key: '/', description: 'Focus search', scope: 'global' },
    { key: 'n', description: 'Create new repository', scope: 'global' },
    { key: 'i', description: 'Open Migration Wizard', scope: 'global' },
    { key: 'd', description: 'Go to Dashboard', scope: 'navigation' },
    { key: 'r', description: 'Go to Repositories', scope: 'navigation' },
    { key: 't', description: 'Go to Teams', scope: 'navigation' },
    { key: 'g', description: 'Open Dev Toolkit', scope: 'global' },
    { key: '?', description: 'Show shortcuts help', scope: 'global' }
]

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

        // Don't trigger with modifier keys (except shift for ?)
        if (e.ctrlKey || e.metaKey || e.altKey) return

        switch (e.key) {
            case '/':
                e.preventDefault()
                onSearch?.()
                break
            case 'n':
                e.preventDefault()
                onCreateRepo?.()
                break
            case 'i':
                e.preventDefault()
                onMigrate?.()
                break
            case 'g':
                e.preventDefault()
                onOpenDevToolkit?.()
                break
            case 'd':
                e.preventDefault()
                onViewChange?.('dashboard')
                break
            case 'r':
                e.preventDefault()
                onViewChange?.('repos')
                break
            case 't':
                e.preventDefault()
                onViewChange?.('teams')
                break
            case '?':
                e.preventDefault()
                setShowHelp(prev => !prev)
                break
            case 'Escape':
                if (showHelp) {
                    e.preventDefault()
                    setShowHelp(false)
                }
                break
        }
    }, [enabled, onSearch, onCreateRepo, onMigrate, onViewChange, onOpenDevToolkit, showHelp])

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])

    return { showHelp, setShowHelp, shortcuts: SHORTCUTS }
}

/**
 * Register a single-key shortcut scoped to the current view.
 * Ignores keystrokes while typing in inputs or when a modifier is held.
 */
export function useContextShortcut({ key, handler, when = true, deps = [] }) {
    useEffect(() => {
        if (!when) return undefined
        function h(e) {
            const tag = (e.target?.tagName || '').toLowerCase()
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
            if (e.metaKey || e.ctrlKey || e.altKey) return
            if (e.key === key) {
                e.preventDefault()
                handler(e)
            }
        }
        window.addEventListener('keydown', h)
        return () => window.removeEventListener('keydown', h)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, when, ...deps])
}
