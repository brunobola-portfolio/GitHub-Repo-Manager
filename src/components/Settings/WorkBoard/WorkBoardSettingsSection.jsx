import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useTrackedRepos } from '../../../hooks/useTrackedRepos'
import { useToast } from '../../../hooks/useToast'
import { useLicense } from '../../../hooks/useLicense'
import { DiscoveryPanel } from './DiscoveryPanel'
import { TrackedReposList } from './TrackedReposList'
import { AddRepoInput } from './AddRepoInput'
import { WebhookConnectPanel } from './WebhookConnectPanel'
import { DangerZoneCard } from './DangerZoneCard'
import { WorkBoardAISection } from './ai/WorkBoardAISection'
import { InsightCard } from '../../ui/InsightCard'

const ACTION_LABELS = {
    pin: 'Pinned',
    unpin: 'Unpinned',
    mute: 'Muted',
    unmute: 'Unmuted',
    track: 'Added',
    untrack: 'Removed',
}

export function WorkBoardSettingsSection() {
    const hook = useTrackedRepos()
    const { toast } = useToast()
    const { license } = useLicense()
    const tier = license?.tier ?? 'free'

    const [filters, setFilters] = useState({ muted: false })

    const filtered = useMemo(() => {
        let list = hook.repos
        if (filters.search) {
            const q = filters.search.toLowerCase()
            list = list.filter(r => r.repo_full_name.toLowerCase().includes(q))
        }
        if (filters.signal) {
            list = list.filter(r => r.source_signal === filters.signal)
        }
        if (filters.muted === false) list = list.filter(r => r.is_muted === 0)
        if (filters.muted === true) list = list.filter(r => r.is_muted === 1)
        return list
    }, [hook.repos, filters])

    const mutedCount = hook.repos.filter(r => r.is_muted === 1).length
    const pinnedCount = hook.repos.filter(r => r.is_pinned === 1).length

    const handleRefresh = async () => {
        try {
            const result = await hook.discover()
            toast.success(`Discovery: +${result.added} added, -${result.removed} removed`)
        } catch (e) {
            toast.error(`Discovery failed: ${e.message}`)
        }
    }

    const handleUpdatePrefs = async (patch) => {
        try {
            await hook.updatePrefs(patch)
            toast.success('Settings saved')
        } catch (e) {
            toast.error(`Save failed: ${e.message}`)
        }
    }

    const handleRowAction = async (repoFullName, action) => {
        const fn = hook[action]
        if (typeof fn !== 'function') return
        try {
            const result = await fn(repoFullName)
            const label = ACTION_LABELS[action] ?? action
            if (result?.operation_id) {
                toast.success(`${label} ${repoFullName}`, {
                    action: 'Undo',
                    onAction: async () => {
                        await hook.undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            } else {
                toast.success(`${label} ${repoFullName}`)
            }
        } catch (e) {
            toast.error(`${action} failed: ${e.message}`)
        }
    }

    const handleBulkAction = async (repos, action) => {
        try {
            const result = await hook.bulkUpdate(repos, action)
            if (result?.operation_id) {
                toast.success(`${action}: ${result.updated} updated${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}`, {
                    action: 'Undo',
                    onAction: async () => {
                        await hook.undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            }
        } catch (e) {
            toast.error(`Bulk ${action} failed: ${e.message}`)
        }
    }

    const handleAdd = async (repo) => {
        try {
            await hook.track(repo)
            toast.success(`Added ${repo}`)
        } catch (e) {
            toast.error(`Add failed: ${e.message}`)
        }
    }

    const handleResetDiscovery = async () => {
        const nonPinned = hook.repos.filter(r => r.is_pinned === 0).map(r => r.repo_full_name)
        if (nonPinned.length > 0) {
            await hook.bulkUpdate(nonPinned, 'untrack')
        }
        await hook.discover()
        toast.success('Discovery reset')
    }

    const handleClearAll = async () => {
        const all = hook.repos.map(r => r.repo_full_name)
        if (all.length > 0) {
            await hook.bulkUpdate(all, 'untrack')
        }
        toast.success('All data cleared')
    }

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

            <DiscoveryPanel
                prefs={hook.prefs}
                totalCount={hook.repos.length}
                mutedCount={mutedCount}
                pinnedCount={pinnedCount}
                isRefreshing={hook.isRefreshing}
                onRefresh={handleRefresh}
                onUpdatePrefs={handleUpdatePrefs}
            />

            <InsightCard tone="default" hover={false}>
                <TrackedReposList
                    repos={filtered}
                    countsBySignal={hook.countsBySignal}
                    filters={filters}
                    isLoading={hook.isLoading}
                    onFilterChange={setFilters}
                    onRowAction={handleRowAction}
                    onBulkAction={handleBulkAction}
                />
            </InsightCard>

            <InsightCard tone="default" hover={false}>
                <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Add a repository</p>
                    <AddRepoInput onAdd={handleAdd} />
                </div>
            </InsightCard>

            <WebhookConnectPanel tier={tier} />
            <WorkBoardAISection />
            <DangerZoneCard onResetDiscovery={handleResetDiscovery} onClearAll={handleClearAll} />
        </div>
    )
}
