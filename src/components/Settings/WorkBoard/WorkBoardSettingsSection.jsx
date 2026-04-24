import { InsightCard } from '../../ui/InsightCard'
import { Sparkles } from 'lucide-react'

export function WorkBoardSettingsSection() {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">Work Board</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Manage tracked repositories, discovery preferences, and webhooks.
                    </p>
                </div>
            </div>
            <InsightCard tone="default" hover={false}>
                <p className="text-sm text-slate-500 dark:text-slate-400">Coming soon…</p>
            </InsightCard>
        </div>
    )
}
