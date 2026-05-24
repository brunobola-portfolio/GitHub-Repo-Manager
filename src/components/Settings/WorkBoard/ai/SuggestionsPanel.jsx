import { Sparkles, Check, X } from 'lucide-react'
import { InsightCard } from '../../../ui/InsightCard'
import { Card } from '../../../ui/Card'
import { Button } from '../../../ui/Button'

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
                            <Card
                                key={`${s.pattern_key}-${dismissKey}`}
                                glass={false}
                                shadow="none"
                                className="rounded-xl p-3 space-y-2"
                            >
                                <div>
                                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{s.title}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.description}</p>
                                </div>
                                {s.repos?.length > 0 && (
                                    <p className="ds-text-meta font-mono text-slate-500 dark:text-slate-400 truncate">
                                        {s.repos.slice(0, 3).join(', ')}{s.repos.length > 3 ? ` +${s.repos.length - 3} more` : ''}
                                    </p>
                                )}
                                <div className="flex items-center gap-2">
                                    <Button variant="primary" size="xs" onClick={() => onApply(s)}>
                                        <Check className="w-3 h-3" /> Apply
                                    </Button>
                                    <Button variant="ghost" size="xs" onClick={() => onDismiss(s.pattern_key, dismissKey)}>
                                        <X className="w-3 h-3" /> Dismiss
                                    </Button>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            </div>
        </InsightCard>
    )
}
