import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Bookmark, Trash2, Plus } from 'lucide-react'
import { useSavedViews } from '../../../hooks/useWorkBoardPresets'
import { Input } from '../../ui/form'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { POPOVER_SURFACE_CLASS } from '../../ui/_variants'

function workBoardFilters(filters) {
    // Keep only the filter keys the Work Board actually uses, drop anything else.
    const { repos = '', authors = '', labels = '', age = '', snoozed = '' } = filters || {}
    return { repos, authors, labels, age, snoozed }
}

/**
 * PresetDropdown — "save current filters as a named view, apply a saved one
 * later". Originally Work Board-only; generalised for G5 so the
 * Repositories filter bar can mount the same affordance against its own
 * scope ('repos') and its own filter shape via `serialize`.
 *
 * @param {object} currentFilters - the caller's current filter state
 * @param {(filters: object) => void} onApply - called with a saved view's
 *   filters when the user picks it from the list
 * @param {string} [scope] - saved-view scope (server + localStorage-under-
 *   mock partition key); defaults to 'work-board' for the original caller
 * @param {(filters: object) => object} [serialize] - projects `currentFilters`
 *   down to the plain, storable shape saved with the view; defaults to the
 *   Work Board's five filter keys
 */
export function PresetDropdown({ currentFilters, onApply, scope = 'work-board', serialize = workBoardFilters }) {
    const { presets, create, remove, loading, error } = useSavedViews(scope)
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState(null)
    const rootRef = useRef(null)

    useEffect(() => {
        function onClickOutside(e) {
            if (open && rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onClickOutside)
        return () => document.removeEventListener('mousedown', onClickOutside)
    }, [open])

    const handleSave = async () => {
        const trimmed = name.trim()
        if (!trimmed) return
        setSaving(true)
        setSaveError(null)
        try {
            await create({ name: trimmed, filters: serialize(currentFilters) })
            setName('')
        } catch (e) {
            setSaveError(e.code === 'preset_exists' ? 'A preset with that name already exists.' : e.message || 'Failed to save')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium border-slate-200/60 dark:border-slate-700/50 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <Bookmark className="w-3 h-3" aria-hidden="true" />
                Presets
                <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className={`absolute right-0 top-full mt-2 w-72 z-[var(--ds-z-popover)] overflow-hidden ${POPOVER_SURFACE_CLASS}`}
                        role="menu"
                    >
                        <div className="p-2 max-h-64 overflow-y-auto">
                            {loading && <div className="p-2 text-xs text-slate-500 dark:text-slate-400">Loading…</div>}
                            {error && <div className="p-2 text-xs text-rose-500">{error.message || "Couldn't load"}</div>}
                            {!loading && !error && presets.length === 0 && (
                                <EmptyState size="inline" title="No presets yet. Save the current filters below." />
                            )}
                            {presets.map(p => (
                                <div key={p.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60">
                                    <button
                                        type="button"
                                        className="flex-1 text-left text-sm text-slate-700 dark:text-slate-200 truncate"
                                        onClick={() => { onApply(serialize(p.filters)); setOpen(false); }}
                                    >
                                        {p.name}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => remove(p.id)}
                                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 text-slate-400 hover:text-rose-500 transition"
                                        aria-label={`Delete preset ${p.name}`}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="border-t border-slate-200/60 dark:border-slate-700/50 p-2 flex items-center gap-2">
                            <div className="flex-1">
                                <Input
                                    size="sm"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                                    placeholder="Save current as…"
                                    aria-label="Preset name"
                                    disabled={saving}
                                />
                            </div>
                            <Button
                                type="button"
                                variant="primary"
                                size="xs"
                                onClick={handleSave}
                                disabled={saving || !name.trim()}
                            >
                                <Plus className="w-3 h-3" aria-hidden="true" />
                                Save
                            </Button>
                        </div>
                        {saveError && <div className="px-2 pb-2 ds-text-meta text-rose-500">{saveError}</div>}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
