import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, FileText } from 'lucide-react'
import { onAppEvent, APP_EVENTS } from '../../../utils/appEvents'

// localStorage prefix for the per-PR/per-commit expanded-files set.
// Final key is `${EXPANDED_STORAGE_KEY}:${storageKey}` where storageKey is
// the same key the surface uses for the reviewed-files set.
export const EXPANDED_STORAGE_KEY = 'diff-collapser:expanded'

function loadExpanded(storageKey) {
    if (!storageKey) return new Set()
    try {
        const raw = localStorage.getItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`)
        return new Set(raw ? JSON.parse(raw) : [])
    } catch { return new Set() }
}

function saveExpanded(storageKey, set) {
    if (!storageKey) return
    try {
        localStorage.setItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`, JSON.stringify([...set]))
    } catch { /* quota — silent */ }
}

/**
 * Wraps a single file's diff with a fold-by-default affordance. Renders
 * a "Show diff (N lines changed)" placeholder until the user opts in,
 * then renders children with `{ collapsed: false }` so the consumer can
 * mount the heavy <DiffView>. Persists the expanded set per storageKey
 * so reloading doesn't lose the user's choice.
 *
 * Listens for two window events for bulk control from the toolbar:
 *  - `diff-collapser:expand-all`
 *  - `diff-collapser:collapse-all`
 *
 * @param {object}   props
 * @param {string}   props.filename
 * @param {number}   [props.additions=0]
 * @param {number}   [props.deletions=0]
 * @param {string}   [props.storageKey]  - PR/commit-scoped key. When falsy,
 *                                          the wrapper is session-only.
 * @param {(state: { collapsed: boolean }) => React.ReactNode} props.children
 */
export function DiffCollapser({ filename, additions = 0, deletions = 0, storageKey, children }) {
    const total = additions + deletions

    const [expanded, setExpanded] = useState(() => loadExpanded(storageKey).has(filename))

    // Re-hydrate when storageKey or filename changes (PR navigation, file switch).
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset on key change
        setExpanded(loadExpanded(storageKey).has(filename))
    }, [storageKey, filename])

    const persist = useCallback((next) => {
        const set = loadExpanded(storageKey)
        if (next) set.add(filename); else set.delete(filename)
        saveExpanded(storageKey, set)
    }, [storageKey, filename])

    const handleExpand = useCallback(() => {
        setExpanded(true)
        persist(true)
    }, [persist])

    // Bulk expand/collapse from the toolbar.
    useEffect(() => {
        const onExpandAll = () => { setExpanded(true); persist(true) }
        const onCollapseAll = () => { setExpanded(false); persist(false) }
        const offs = [
            onAppEvent(APP_EVENTS.DIFF_EXPAND_ALL, onExpandAll),
            onAppEvent(APP_EVENTS.DIFF_COLLAPSE_ALL, onCollapseAll),
        ]
        return () => offs.forEach(off => off())
    }, [persist])

    if (expanded) return children({ collapsed: false })

    return (
        <div className="diff-collapser p-6 text-center bg-slate-50/60 dark:bg-slate-800/30 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg m-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 mb-3">
                <FileText className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Large diff — {total} lines changed
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto">
                Folded by default to keep the page snappy. Expand only this file, or use Expand all in the toolbar.
            </p>
            <button
                type="button"
                onClick={handleExpand}
                className="inline-flex items-center gap-1 mt-4 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
                <ChevronRight className="w-3.5 h-3.5" /> Show diff
            </button>
        </div>
    )
}
