import { Sparkles, Check, X } from 'lucide-react'
import { InsightCard } from '../../../ui/InsightCard'

export function SuggestionsPanel({ suggestions, onApply, onDismiss }) {
    if (!suggestions || suggestions.length === 0) return null

    return (
        <InsightCard tone="ai" hover={false}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Suggestions</p>
                </div>
                <div className="space-y-2">
                    {suggestions.map(s => {
                        const dismissKey = s.dismiss_key ?? s.repos?.[0] ?? ''
                        return (
                            <div
                                key={`${s.pattern_key}-${dismissKey}`}
                                className="rounded-xl border border-slate-200/60 dark:border-slate-700/40 p-3 space-y-2"
                            >
                                <div>
                                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{s.title}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.description}</p>
                                </div>
                                {s.repos?.length > 0 && (
                                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                                        {s.repos.slice(0, 3).join(', ')}{s.repos.length > 3 ? ` +${s.repos.length - 3} more` : ''}
                                    </p>
                                )}
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onApply(s)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
                                    >
                                        <Check className="w-3 h-3" /> Apply
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDismiss(s.pattern_key, dismissKey)}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                    >
                                        <X className="w-3 h-3" /> Dismiss
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </InsightCard>
    )
}
