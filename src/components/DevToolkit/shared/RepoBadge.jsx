import { useState, useRef, useEffect, useMemo } from 'react'
import { Pin, PinOff, ChevronDown, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Input } from '../../ui/form'

export function RepoBadge({ repos = [], selectedRepo, isPinned, onSelectRepo, onTogglePin }) {
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
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-all ${
                        isPinned
                            ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400'
                    }`}
                >
                    {selectedRepo ? (
                        <span className="truncate max-w-[280px]">{selectedRepo.full_name}</span>
                    ) : (
                        <span className="text-slate-500 dark:text-slate-400">Select repo...</span>
                    )}
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                </button>
                {selectedRepo && (
                    <button
                        type="button"
                        onClick={onTogglePin}
                        className={`p-1.5 rounded-lg transition-colors ${
                            isPinned ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                        title={isPinned ? 'Unpin repo' : 'Pin repo'}
                        aria-label={isPinned ? 'Unpin repository' : 'Pin repository'}
                    >
                        {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                    </button>
                )}
            </div>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-[var(--ds-z-popover)] mt-1 left-0 w-80 max-w-[calc(100vw-1rem)] max-h-60 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
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
                                    onClick={() => { onSelectRepo(repo); setOpen(false); setQuery('') }}
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors ${
                                        selectedRepo?.id === repo.id ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'
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
