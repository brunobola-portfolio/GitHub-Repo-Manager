import { RefreshCw, Info } from 'lucide-react'
import { formatRelativeTime } from '../../../utils/format'
import { Select } from '../../ui/Select'
import { Switch } from '../../ui/form'

const WINDOW_OPTIONS = [30, 60, 90, 180]

function windowLabel(days) {
    if (days === 30) return '4 weeks'
    return `${days} days`
}

export function DiscoveryPanel({
    prefs,
    totalCount,
    mutedCount,
    pinnedCount,
    isRefreshing,
    onRefresh,
    onUpdatePrefs,
}) {
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                    {`Last synced ${formatRelativeTime(prefs?.last_discovery_at) || 'never'} · ${totalCount} tracked · ${mutedCount} muted · ${pinnedCount} pinned`}
                </p>
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    aria-label="Refresh"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 hover:bg-brand-100 dark:hover:bg-brand-900/50 border border-brand-200 dark:border-brand-700/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ds-focus-ring"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/40">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-300">Activity window</span>
                    <Select
                        label="Activity window"
                        size="sm"
                        value={prefs?.discovery_window_days ?? 60}
                        onChange={(v) => onUpdatePrefs({ discovery_window_days: v })}
                        options={WINDOW_OPTIONS.map(days => ({ value: days, label: windowLabel(days) }))}
                        className="w-32"
                    />
                </div>

                <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-300">Auto-mute bots</span>
                    <Switch
                        size="sm"
                        checked={prefs?.auto_mute_bots === 1}
                        onChange={(v) => onUpdatePrefs({ auto_mute_bots: v ? 1 : 0 })}
                        label="Auto-mute bots"
                    />
                </div>
            </div>

            <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Discovery scans repos where you&apos;re a reviewer, author, assignee, owner, or recent committer.
            </p>
        </div>
    )
}
