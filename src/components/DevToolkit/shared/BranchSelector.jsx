import { useState, useMemo, useRef, useEffect } from 'react'
import { GitBranch, ChevronDown, Star, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Input } from '../../ui/form'

export function BranchSelector({ branches = [], selected, onSelect, label, defaultBranch }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const containerRef = useRef(null)

    useEffect(() => {
        if (!open) return
        const handler = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    const filtered = useMemo(() => {
        if (!query) return branches
        const q = query.toLowerCase()
        return branches.filter(b => (b.name || b).toLowerCase().includes(q))
    }, [branches, query])

    const displayName = selected || 'Select branch...'
    const isDefault = selected && (selected === defaultBranch || selected === 'main' || selected === 'master')

    return (
        <div ref={containerRef} className="relative flex-1">
            {label && <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</label>}
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 text-sm hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
            >
                <span className="flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                    <span className={selected ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}>
                        {displayName}
                    </span>
                    {isDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-[var(--ds-z-popover)] mt-1 w-full max-h-48 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
                    >
                        {branches.length > 5 && (
                            <div className="sticky top-0 bg-white dark:bg-slate-900 p-2 border-b border-slate-100 dark:border-slate-800">
                                <Input
                                    size="sm"
                                    leadingIcon={Search}
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search branches..."
                                    aria-label="Search branches"
                                    autoFocus
                                />
                            </div>
                        )}
                        {filtered.map(branch => {
                            const name = branch.name || branch
                            return (
                                <button
                                    key={name}
                                    type="button"
                                    onClick={() => { onSelect(name); setOpen(false); setQuery('') }}
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex items-center gap-1.5 ${
                                        selected === name ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'
                                    }`}
                                >
                                    {name}
                                    {(name === defaultBranch || name === 'main' || name === 'master') && (
                                        <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                                    )}
                                </button>
                            )
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
