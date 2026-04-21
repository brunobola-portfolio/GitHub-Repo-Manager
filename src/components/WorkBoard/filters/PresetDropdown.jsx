import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Bookmark, Trash2, Plus } from 'lucide-react'
import { useWorkBoardPresets } from '../../../hooks/useWorkBoardPresets'

function serialisableFilters(filters) {
    // Keep only the filter keys we actually use, drop anything else.
    const { repos = '', authors = '', labels = '', age = '', snoozed = '' } = filters || {}
    return { repos, authors, labels, age, snoozed }
}

export function PresetDropdown({ currentFilters, onApply }) {
    const { presets, create, remove, loading, error } = useWorkBoardPresets()
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
            await create({ name: trimmed, filters: serialisableFilters(currentFilters) })
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
                        className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-slate-200/60 dark:border-slate-700/50 bg-white dark:bg-slate-900 shadow-xl z-40 overflow-hidden"
                        role="menu"
                    >
                        <div className="p-2 max-h-64 overflow-y-auto">
                            {loading && <div className="p-2 text-xs text-slate-400">Loading…</div>}
                            {error && <div className="p-2 text-xs text-rose-500">{error.message || 'Failed to load'}</div>}
                            {!loading && !error && presets.length === 0 && (
                                <div className="p-2 text-xs text-slate-400">No presets yet. Save the current filters below.</div>
                            )}
                            {presets.map(p => (
                                <div key={p.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60">
                                    <button
                                        type="button"
                                        className="flex-1 text-left text-sm text-slate-700 dark:text-slate-200 truncate"
                                        onClick={() => { onApply(serialisableFilters(p.filters)); setOpen(false); }}
                                    >
                                        {p.name}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => remove(p.id)}
                                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 transition"
                                        aria-label={`Delete preset ${p.name}`}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="border-t border-slate-200/60 dark:border-slate-700/50 p-2 flex items-center gap-2">
                            <input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                                placeholder="Save current as…"
                                className="flex-1 px-2 py-1 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                disabled={saving}
                            />
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving || !name.trim()}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
                            >
                                <Plus className="w-3 h-3" aria-hidden="true" />
                                Save
                            </button>
                        </div>
                        {saveError && <div className="px-2 pb-2 text-[11px] text-rose-500">{saveError}</div>}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
