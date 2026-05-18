import { Sparkles } from 'lucide-react'
import { useTrackedRepos } from '../../hooks/useTrackedRepos'
import { useToast } from '../../hooks/useToast'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

export function EmptyStateDiscovery({ plainTitle, plainSubtitle, icon: Icon = Sparkles }) {
    const hook = useTrackedRepos()
    const { toast } = useToast()

    const hasTrackedAny = hook.repos.length > 0 || Boolean(hook.prefs?.last_discovery_at)

    const handleDiscover = async () => {
        try {
            const result = await hook.discover()
            toast.success(`Discovery complete: +${result.added} added`)
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Discovery failed' })
        }
    }

    if (hasTrackedAny) {
        return (
            <div data-testid="empty-state" className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">{plainTitle}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{plainSubtitle}</p>
            </div>
        )
    }

    return (
        <div data-testid="empty-state" className="flex flex-col items-center justify-center py-12 text-center gap-3 px-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-[color:var(--ds-accent-brand)]" />
            </div>
            <div className="space-y-1 max-w-sm">
                <p className="text-base font-semibold text-slate-800 dark:text-slate-100">Let&apos;s find your work</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    We&apos;ll scan your GitHub and surface everything where you&apos;re
                    a reviewer, author, or assignee.
                </p>
            </div>
            <Button variant="primary" onClick={handleDiscover} disabled={hook.isRefreshing} className="mt-2">
                {hook.isRefreshing
                    ? <Spinner size="md" tone="onPrimary" />
                    : <Sparkles className="w-4 h-4" />}
                Discover my work
            </Button>
        </div>
    )
}
