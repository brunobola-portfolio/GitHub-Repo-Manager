import { Activity, Pin, VolumeX, Clock, Crown, Sparkles } from 'lucide-react'
import { useWorkBoardAI } from '../../../hooks/useWorkBoardAI'
import { formatRelativeTime } from '../../../utils/format'

const TIER_LABEL = {
    free: 'Free',
    pro: 'Pro',
    enterprise: 'Enterprise',
}

/**
 * WorkBoardSummary — editorial right-rail card. Shows at-a-glance counts,
 * last-sync time, plan tier, and current AI Assistant enablement. Never
 * drives behaviour — purely informational.
 */
export function WorkBoardSummary({ prefs, totalCount, mutedCount, pinnedCount, tier }) {
    const ai = useWorkBoardAI()
    const tierLabel = TIER_LABEL[tier] || 'Free'

    return (
        <div className="rounded-2xl ring-1 ring-indigo-500/25 dark:ring-indigo-500/35">
            <div className="rounded-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-4 space-y-4">
                <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-indigo-500" aria-hidden="true" />
                    <span className="ds-text-micro font-semibold uppercase tracking-[0.14em] text-[color:var(--ds-accent-brand)] dark:text-indigo-300">
                        Board status
                    </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    <StatTile label="Tracked" value={totalCount} icon={Activity} color="indigo" />
                    <StatTile label="Pinned" value={pinnedCount} icon={Pin} color="emerald" />
                    <StatTile label="Muted" value={mutedCount} icon={VolumeX} color="slate" />
                </div>

                <div className="flex items-center gap-1.5 ds-text-meta text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    <span>Last sync</span>
                    <span className="ml-auto font-medium text-slate-700 dark:text-slate-200">
                        {formatRelativeTime(prefs?.last_discovery_at) || 'never'}
                    </span>
                </div>

                <div className="flex items-center gap-1.5 ds-text-meta text-slate-500 dark:text-slate-400">
                    <Crown className="w-3 h-3" aria-hidden="true" />
                    <span>Plan</span>
                    <span className={`ml-auto inline-flex items-center px-1.5 py-0.5 rounded-full font-semibold ds-text-micro uppercase tracking-wide ${
                        tier === 'enterprise'
                            ? 'bg-amber-500 text-white'
                            : tier === 'pro'
                            ? 'bg-indigo-500 text-white'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                    }`}>
                        {tierLabel}
                    </span>
                </div>

                <div className="flex items-center gap-1.5 ds-text-meta text-slate-500 dark:text-slate-400">
                    <Sparkles className="w-3 h-3" aria-hidden="true" />
                    <span>Repo Advisor</span>
                    <span className={`ml-auto inline-flex items-center gap-1 font-semibold ds-text-micro uppercase tracking-wide ${
                        ai.enabled
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                    }`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${ai.enabled ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]' : 'bg-slate-300 dark:bg-slate-600'}`} />
                        {ai.enabled ? 'On' : 'Off'}
                    </span>
                </div>
            </div>
        </div>
    )
}

function StatTile({ label, value, icon: Icon, color }) {
    const colorClass = {
        indigo: 'bg-indigo-50 text-[color:var(--ds-accent-brand)] ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-200 dark:ring-indigo-800/60',
        emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800/60',
        slate: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800/80 dark:text-slate-300 dark:ring-slate-700',
    }[color] || ''
    return (
        <div className={`rounded-xl p-2.5 text-center ring-1 ring-inset ${colorClass}`}>
            <Icon className="w-3.5 h-3.5 mx-auto mb-1 opacity-70" aria-hidden="true" />
            <div className="text-lg font-bold leading-none">{value}</div>
            <div className="text-[9px] uppercase tracking-wide mt-0.5 opacity-80">{label}</div>
        </div>
    )
}
