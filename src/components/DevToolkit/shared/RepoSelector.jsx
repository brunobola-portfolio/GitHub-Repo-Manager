import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Input } from '../../ui/form'

export function RepoSelector({ repos = [], selected, onSelect }) {
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
        if (!query) return repos.slice(0, 30)
        const q = query.toLowerCase()
        return repos.filter(r => r.full_name?.toLowerCase().includes(q)).slice(0, 30)
    }, [repos, query])

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 text-sm hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
            >
                <span className={selected ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}>
                    {selected?.full_name || 'Select repository...'}
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
                        className="absolute z-[var(--ds-z-popover)] mt-1 w-full max-h-60 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
                    >
                        <div className="sticky top-0 bg-white dark:bg-slate-900 p-2 border-b border-slate-100 dark:border-slate-800">
                            <Input
                                size="sm"
                                leadingIcon={Search}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search repos..."
                                aria-label="Search repositories"
                                autoFocus
                            />
                        </div>
                        {filtered.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-slate-400">No repos found</div>
                        ) : (
                            filtered.map(repo => (
                                <button
                                    key={repo.id || repo.full_name}
                                    type="button"
                                    onClick={() => { onSelect(repo); setOpen(false); setQuery('') }}
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors ${
                                        selected?.id === repo.id ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'
                                    }`}
                                >
                                    {repo.full_name}
                                </button>
                            ))
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
