import { RefreshCw, Info } from 'lucide-react'

const WINDOW_OPTIONS = [30, 60, 90, 180]

function windowLabel(days) {
    if (days === 30) return '4 weeks'
    return `${days} days`
}

function relativeTime(iso) {
    if (!iso) return 'never'
    const ms = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(ms / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
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
                    {`Last synced ${relativeTime(prefs?.last_discovery_at)} · ${totalCount} tracked · ${mutedCount} muted · ${pinnedCount} pinned`}
                </p>
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    aria-label="Refresh"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-700/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/40">
                <label className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-300">Activity window</span>
                    <select
                        aria-label="Activity window"
                        value={prefs?.discovery_window_days ?? 60}
                        onChange={(e) => onUpdatePrefs({ discovery_window_days: Number.parseInt(e.target.value, 10) })}
                        className="px-2 py-1 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                        {WINDOW_OPTIONS.map(days => (
                            <option key={days} value={days}>{windowLabel(days)}</option>
                        ))}
                    </select>
                </label>

                <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-300">Auto-mute bots</span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={prefs?.auto_mute_bots === 1}
                        aria-label="Auto-mute bots"
                        onClick={() => onUpdatePrefs({ auto_mute_bots: prefs?.auto_mute_bots ? 0 : 1 })}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            prefs?.auto_mute_bots
                                ? 'bg-indigo-500'
                                : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                prefs?.auto_mute_bots ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                        />
                    </button>
                </div>
            </div>

            <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Discovery scans repos where you&apos;re a reviewer, author, assignee, owner, or recent committer.
            </p>
        </div>
    )
}
