import { InsightCard } from '../../../ui/InsightCard'
import { BarChart3 } from 'lucide-react'

function centsToUsd(c) {
    return `$${(c / 100).toFixed(2)}`
}

export function AIActivityCard({ activity }) {
    if (!activity) return null
    const unlimited = activity.cap_cents === 0
    const pct = unlimited
        ? 0
        : Math.min(100, Math.round((activity.spent_cents / Math.max(1, activity.cap_cents)) * 100))

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-slate-500" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">AI activity</p>
                    <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{activity.month}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Spent <strong className="text-slate-800 dark:text-slate-200">{centsToUsd(activity.spent_cents)}</strong>
                    {' '}of{' '}
                    {unlimited
                        ? <strong className="text-slate-800 dark:text-slate-200">unlimited</strong>
                        : <strong className="text-slate-800 dark:text-slate-200">{centsToUsd(activity.cap_cents)}</strong>}
                    {' '}this month.
                </p>
                {!unlimited && (
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                            data-testid="ai-progress-bar"
                            className="h-full bg-brand-500 transition-all"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                )}
            </div>
        </InsightCard>
    )
}
