import { Sparkles, Loader2 } from 'lucide-react'
import { useTrackedRepos } from '../../hooks/useTrackedRepos'
import { useToast } from '../../hooks/useToast'

export function EmptyStateDiscovery({ plainTitle, plainSubtitle, icon: Icon = Sparkles }) {
    const hook = useTrackedRepos()
    const { toast } = useToast()

    const hasTrackedAny = hook.repos.length > 0 || Boolean(hook.prefs?.last_discovery_at)

    const handleDiscover = async () => {
        try {
            const result = await hook.discover()
            toast.success(`Discovery complete: +${result.added} added`)
        } catch (e) {
            toast.error(`Discovery failed: ${e.message}`)
        }
    }

    if (hasTrackedAny) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">{plainTitle}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{plainSubtitle}</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-3 px-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/15 to-purple-500/15 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-indigo-500" />
            </div>
            <div className="space-y-1 max-w-sm">
                <p className="text-base font-semibold text-slate-800 dark:text-slate-100">Let&apos;s find your work</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    We&apos;ll scan your GitHub and surface everything where you&apos;re
                    a reviewer, author, or assignee.
                </p>
            </div>
            <button
                type="button"
                onClick={handleDiscover}
                disabled={hook.isRefreshing}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl shadow-sm shadow-indigo-500/25 transition-colors"
            >
                {hook.isRefreshing
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Sparkles className="w-4 h-4" />}
                Discover my work
            </button>
        </div>
    )
}
