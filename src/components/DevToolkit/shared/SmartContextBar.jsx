import { X, Sparkles, Lightbulb } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const TYPE_STYLES = {
    feature: { label: 'Feature', color: 'text-emerald-400' },
    bugfix: { label: 'Bugfix', color: 'text-amber-400' },
    refactor: { label: 'Refactor', color: 'text-brand-400' },
    breaking: { label: 'Breaking', color: 'text-rose-400' },
    chore: { label: 'Chore', color: 'text-slate-400' },
}

const COMPLEXITY_STYLES = {
    low: 'text-emerald-400',
    medium: 'text-amber-400',
    high: 'text-rose-400',
}

export function SmartContextBar({ analysis, diffSummary, loading, onSuggestionClick, onDismissSuggestion }) {
    if (loading) {
        return (
            <div className="px-4 py-2 border-b border-brand-500/20 bg-brand-500/5">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse" /> Analyzing changes...
                </div>
            </div>
        )
    }

    if (!analysis || !diffSummary) return null

    const typeStyle = TYPE_STYLES[analysis.changeType] || TYPE_STYLES.chore
    const complexityStyle = COMPLEXITY_STYLES[analysis.complexity] || COMPLEXITY_STYLES.medium

    return (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="px-4 py-2.5 border-b border-brand-500/20 bg-brand-500/5">
            <div className="flex items-center gap-2 text-xs flex-wrap">
                <Sparkles className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                <span className={`font-medium ${typeStyle.color}`}>{typeStyle.label}</span>
                <span className="text-slate-500">&middot;</span>
                <span className="text-slate-400">{diffSummary.files_changed} files</span>
                <span className="text-slate-500">&middot;</span>
                <span className="text-emerald-400">+{diffSummary.additions}</span>
                <span className="text-rose-400">&minus;{diffSummary.deletions}</span>
                <span className="text-slate-500">&middot;</span>
                <span className={complexityStyle}>{analysis.complexity}</span>
            </div>

            <AnimatePresence>
                {analysis.suggestions?.length > 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Lightbulb className="w-3 h-3 text-amber-400 shrink-0" />
                        {analysis.suggestions.map((s, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 ds-text-meta rounded-full bg-brand-500/10 text-brand-300 hover:bg-brand-500/20 border border-brand-500/20 transition-colors">
                                <button type="button" onClick={() => onSuggestionClick?.(s)} className="hover:underline">{s.message}</button>
                                <button type="button" onClick={() => onDismissSuggestion?.(i)} className="ml-0.5 hover:text-white" aria-label="Dismiss">
                                    <X className="w-2.5 h-2.5" />
                                </button>
                            </span>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}
