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
import { WorkBoardSectionHeader } from './WorkBoardSectionHeader'
import { WorkBoardSummary } from './WorkBoardSummary'
import { PanelHeader } from '../../ui/PanelHeader'

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
            toast.errorFromException(e, { fallbackTitle: 'Discovery failed' })
        }
    }

    const handleUpdatePrefs = async (patch) => {
        try {
            await hook.updatePrefs(patch)
            toast.success('Settings saved')
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Save failed' })
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
            toast.errorFromException(e, { fallbackTitle: `${action} failed` })
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
            toast.errorFromException(e, { fallbackTitle: `Bulk ${action} failed` })
        }
    }

    const handleAdd = async (repo) => {
        try {
            await hook.track(repo)
            toast.success(`Added ${repo}`)
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Add failed' })
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
        <div className="space-y-5">
            <PanelHeader
                eyebrowIcon={Sparkles}
                eyebrow="Work Board"
                title="Tracked repositories"
                description="Manage discovery, webhooks and Repo Advisor, which keeps your board tidy."
            />

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-5 lg:items-start">
                {/* ─────────── Left column: configuration ─────────── */}
                <div className="space-y-4 min-w-0">
                    {/* 01 — Discovery */}
                    <section className="rounded-2xl bg-indigo-500/[0.03] dark:bg-indigo-500/[0.05] ring-1 ring-inset ring-indigo-500/15 dark:ring-indigo-500/20 p-4">
                        <WorkBoardSectionHeader
                            step={1}
                            title="Discovery"
                            description="Automatically find repos you contribute to."
                        />
                        <DiscoveryPanel
                            prefs={hook.prefs}
                            totalCount={hook.repos.length}
                            mutedCount={mutedCount}
                            pinnedCount={pinnedCount}
                            isRefreshing={hook.isRefreshing}
                            onRefresh={handleRefresh}
                            onUpdatePrefs={handleUpdatePrefs}
                        />
                    </section>

                    {/* 02 — Tracked repositories */}
                    <section className="rounded-2xl bg-white/60 dark:bg-slate-900/50 ring-1 ring-inset ring-slate-200/70 dark:ring-slate-800 p-4">
                        <WorkBoardSectionHeader
                            step={2}
                            title="Tracked repositories"
                            description="Pin, mute, or remove repos from your board."
                        />
                        <TrackedReposList
                            repos={filtered}
                            countsBySignal={hook.countsBySignal}
                            filters={filters}
                            isLoading={hook.isLoading}
                            onFilterChange={setFilters}
                            onRowAction={handleRowAction}
                            onBulkAction={handleBulkAction}
                        />
                    </section>

                    {/* 03 — Add repository */}
                    <section className="rounded-2xl bg-white/60 dark:bg-slate-900/50 ring-1 ring-inset ring-slate-200/70 dark:ring-slate-800 p-4">
                        <WorkBoardSectionHeader
                            step={3}
                            title="Add a repository"
                            description="Track any public or private repo by full name (owner/repo)."
                        />
                        <AddRepoInput onAdd={handleAdd} />
                    </section>

                    {/* 04 — Webhooks */}
                    <section className="rounded-2xl bg-white/60 dark:bg-slate-900/50 ring-1 ring-inset ring-slate-200/70 dark:ring-slate-800 p-4">
                        <WorkBoardSectionHeader
                            step={4}
                            title="Webhooks"
                            description="Stream GitHub events in real time so your board is always fresh."
                        />
                        <WebhookConnectPanel tier={tier} />
                    </section>

                    {/* 05 — AI commands */}
                    <section className="rounded-2xl bg-white/60 dark:bg-slate-900/50 ring-1 ring-inset ring-slate-200/70 dark:ring-slate-800 p-4">
                        <WorkBoardSectionHeader
                            step={5}
                            title="AI commands"
                            description="Natural-language actions and smart suggestions for your board."
                        />
                        <WorkBoardAISection />
                    </section>

                    {/* Danger zone — full-width, clearly separated */}
                    <DangerZoneCard onResetDiscovery={handleResetDiscovery} onClearAll={handleClearAll} />
                </div>

                {/* ─────────── Right rail: summary ─────────── */}
                <aside className="space-y-4 lg:sticky lg:top-2">
                    <WorkBoardSummary
                        prefs={hook.prefs}
                        totalCount={hook.repos.length}
                        mutedCount={mutedCount}
                        pinnedCount={pinnedCount}
                        tier={tier}
                    />
                </aside>
            </div>
        </div>
    )
}
