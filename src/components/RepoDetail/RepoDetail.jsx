import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useRepoDetail } from '../../hooks/useRepoDetail'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { OverviewTab } from './OverviewTab'
// Non-default tabs lazy-loaded — most users land on Overview and never
// open Settings/Releases/Actions. Each tab now ships in its own chunk.
const BranchesTab = lazy(() => import('./BranchesTab').then(m => ({ default: m.BranchesTab })))
const ReleasesTab = lazy(() => import('./ReleasesTab').then(m => ({ default: m.ReleasesTab })))
const IssuesTab = lazy(() => import('./IssuesTab').then(m => ({ default: m.IssuesTab })))
const PullRequestsTab = lazy(() => import('./PullRequestsTab').then(m => ({ default: m.PullRequestsTab })))
const SettingsTab = lazy(() => import('./SettingsTab').then(m => ({ default: m.SettingsTab })))
const ActionsTab = lazy(() => import('./ActionsTab').then(m => ({ default: m.ActionsTab })))
const CommitsTab = lazy(() => import('./CommitsTab').then(m => ({ default: m.CommitsTab })))
import {
    ArrowLeft, GitBranch, GitCommit, Tag, CircleDot, GitPullRequest, Settings,
    FileText, Star, Eye, GitFork, ExternalLink, Lock, Globe, Loader2, Zap
} from 'lucide-react'
import { Spinner, SectionSpinner } from '../ui/Spinner'
import { ConfirmModal } from '../ui/ConfirmModal'
import { TabBar } from '../ui/TabBar'
import { TrackedChip } from '../WorkBoard/TrackedChip'
import { PageHeader } from '../ui/PageHeader'
import { PageMount } from '../ui/PageMount'
import { HeroHalo } from '../ui/HeroHalo'

const TABS = [
    { id: 'overview', label: 'Overview', icon: FileText },
    { id: 'branches', label: 'Branches', icon: GitBranch },
    { id: 'commits', label: 'Commits', icon: GitCommit },
    { id: 'releases', label: 'Releases', icon: Tag },
    { id: 'actions', label: 'Actions', icon: Zap },
    { id: 'issues', label: 'Issues', icon: CircleDot },
    { id: 'pulls', label: 'Pull Requests', icon: GitPullRequest },
    { id: 'settings', label: 'Settings', icon: Settings }
]

export function RepoDetail({ repo, onBack, onStartReview, onGenerateDescription, initialTab = 'overview', onRepoMutated, onTabChange }) {
    const [activeTab, setActiveTab] = useState(initialTab)
    const [repoData, setRepoData] = useState(repo)
    const [loadingRepo, setLoadingRepo] = useState(false)
    const [isStaleData, setIsStaleData] = useState(false)

    // Unsaved-changes guard for the Settings tab. SettingsTab reports its dirty
    // bit up via onDirtyChange; a queued navigation (tab switch or Back) is held
    // in pendingNav until the user chooses Discard (proceed) or Stay (dismiss).
    const [settingsDirty, setSettingsDirty] = useState(false)
    const [pendingNav, setPendingNav] = useState(null)

    // A navigation must be guarded only when leaving a *dirty* Settings tab.
    const guardLeaving = (nextTab) =>
        activeTab === 'settings' && settingsDirty && nextTab !== 'settings'

    const requestTabChange = (nextTab) => {
        if (guardLeaving(nextTab)) setPendingNav({ type: 'tab', tab: nextTab })
        else setActiveTab(nextTab)
    }

    const requestBack = () => {
        if (guardLeaving(null)) setPendingNav({ type: 'back' })
        else onBack()
    }

    const confirmDiscard = () => {
        const nav = pendingNav
        setPendingNav(null)
        setSettingsDirty(false)
        if (nav?.type === 'tab') setActiveTab(nav.tab)
        else if (nav?.type === 'back') onBack()
    }

    const owner = repo.owner?.login || repo.full_name?.split('/')[0]
    const repoName = repo.name
    const api = useRepoDetail(owner, repoName)

    // Mirror of repoData kept in sync via setRepoData wrapper — lets
    // handleRepoMutated compute the next shape from the latest committed
    // value without depending on `repoData` in its useCallback deps (which
    // would invalidate the callback identity on every fetch).
    const repoDataRef = useRef(repo)
    const updateRepoData = useCallback((value) => {
        repoDataRef.current = value
        setRepoData(value)
    }, [])

    // Fetch fresh repo data on mount
    const loadRepo = useCallback(async () => {
        setLoadingRepo(true)
        setIsStaleData(false)
        try {
            const data = await api.fetchRepo()
            updateRepoData(data.data || data)
        } catch {
            // Fallback to prop data, but indicate it may be stale
            setIsStaleData(true)
        } finally {
            setLoadingRepo(false)
        }
    }, [api, updateRepoData])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadRepo()
    }, [loadRepo])

    // Report the active tab up so App can mirror it into the URL hash.
    useEffect(() => {
        onTabChange?.(activeTab)
    }, [activeTab, onTabChange])

    // Follow `initialTab` when it changes from outside (browser back/forward
    // landing on a different #/repo/.../:tab for the repo already on screen).
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab(initialTab)
    }, [initialTab])

    // Local repo-data setter that also notifies the App-level repos list
    // so RepoList / Dashboard cards reflect the change without a refetch.
    // Forwards the freshly computed repo object up so the parent can patch
    // its lists in-place; falls back to a server refetch when the caller
    // doesn't have the new shape (signal-only call).
    const handleRepoMutated = useCallback((updater) => {
        const prev = repoDataRef.current
        let next = null
        if (typeof updater === 'function') next = updater(prev)
        else if (updater && typeof updater === 'object') next = { ...prev, ...updater }

        if (next) {
            updateRepoData(next)
            onRepoMutated?.(next)
        } else {
            // Signal-only: re-fetch detail and let parent decide via fallback.
            loadRepo()
            onRepoMutated?.(null)
        }
    }, [loadRepo, onRepoMutated, updateRepoData])

    const r = repoData

    return (
        <PageMount className="space-y-6 relative">
            <HeroHalo palette="indigo" intensity="subtle" position="top" />
            {isStaleData && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-sm text-amber-700 dark:text-amber-400">
                    <span>Could not refresh repo data. Showing cached version.</span>
                </div>
            )}
            {/* Header */}
            <div className="relative flex items-start gap-4">
                <Button variant="ghost" size="sm" onClick={requestBack} className="mt-1 shrink-0">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>

                <div className="flex-1 min-w-0">
                    <PageHeader
                        title={r.full_name || `${owner}/${repoName}`}
                        description={r.description || undefined}
                        className="mb-0"
                        titleAccessory={
                            <>
                                <TrackedChip repoFullName={r.full_name || `${owner}/${repoName}`} />
                                <Badge
                                    tone={r.private ? 'warning' : 'success'}
                                    icon={r.private ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                                >
                                    {r.private ? 'Private' : 'Public'}
                                </Badge>
                                {r.archived && (
                                    <Badge tone="neutral">Archived</Badge>
                                )}
                                {r.fork && (
                                    <Badge tone="violet" icon={<GitFork className="w-3 h-3" />}>
                                        Fork
                                    </Badge>
                                )}
                            </>
                        }
                    />

                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {r.language && (
                            <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded-full bg-brand-500" />
                                {r.language}
                            </span>
                        )}
                        <span className="flex items-center gap-1"><Star className="w-3 h-3" /> {r.stargazers_count ?? 0}</span>
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {r.watchers_count ?? 0}</span>
                        <span className="flex items-center gap-1"><GitFork className="w-3 h-3" /> {r.forks_count ?? 0}</span>
                        {r.open_issues_count > 0 && (
                            <span className="flex items-center gap-1"><CircleDot className="w-3 h-3" /> {r.open_issues_count} open issues</span>
                        )}
                        <a href={r.html_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline ml-auto whitespace-nowrap">
                            View on GitHub <ExternalLink className="w-3 h-3" />
                        </a>
                    </div>

                    {r.topics?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {r.topics.map(topic => (
                                <Badge key={topic} tone="brand" ring>
                                    {topic}
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>

                {loadingRepo && <Spinner size="md" className="shrink-0" />}
            </div>

            {/* Tabs — fade gradient at horizontal edges signals overflow on narrow viewports (slice 5 row 8) */}
            <TabBar
                tabs={TABS}
                activeTab={activeTab}
                onTabChange={requestTabChange}
                variant="underline"
                layoutId="repo-detail-tabs"
                className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]"
            />

            {/* Tab Content */}
            <div role="tabpanel" id={`tabpanel-repo-detail-tabs-${activeTab}`} aria-labelledby={`tab-repo-detail-tabs-${activeTab}`}>
                <Suspense fallback={<SectionSpinner />}>
                    {activeTab === 'overview' && <OverviewTab api={api} repoData={r} onUpdate={handleRepoMutated} />}
                    {activeTab === 'branches' && <BranchesTab api={api} repoData={r} />}
                    {activeTab === 'commits' && <CommitsTab repo={r} />}
                    {activeTab === 'releases' && <ReleasesTab api={api} />}
                    {activeTab === 'actions' && <ActionsTab repo={r} />}
                    {activeTab === 'issues' && <IssuesTab api={api} repoFullName={`${owner}/${repoName}`} />}
                    {activeTab === 'pulls' && <PullRequestsTab api={api} onStartReview={onStartReview} onGenerateDescription={onGenerateDescription} />}
                    {activeTab === 'settings' && <SettingsTab owner={owner} repo={repoName} api={api} repoData={r} onUpdate={handleRepoMutated} onDirtyChange={setSettingsDirty} />}
                </Suspense>
            </div>

            {/* Unsaved-changes guard when leaving a dirty Settings tab */}
            <ConfirmModal
                isOpen={!!pendingNav}
                onClose={() => setPendingNav(null)}
                onConfirm={confirmDiscard}
                title="Discard unsaved changes?"
                message="You have unsaved changes in Settings. Leaving this tab will discard them."
                confirmText="Discard"
                cancelText="Stay"
                variant="warning"
            />
        </PageMount>
    )
}
