import { useState, useEffect, useCallback } from 'react'
import { useRepoDetail } from '../../hooks/useRepoDetail'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { OverviewTab } from './OverviewTab'
import { BranchesTab } from './BranchesTab'
import { ReleasesTab } from './ReleasesTab'
import { IssuesTab } from './IssuesTab'
import { PullRequestsTab } from './PullRequestsTab'
import { SettingsTab } from './SettingsTab'
import { ActionsTab } from './ActionsTab'
import {
    ArrowLeft, GitBranch, Tag, CircleDot, GitPullRequest, Settings,
    FileText, Star, Eye, GitFork, ExternalLink, Lock, Globe, Loader2, Zap
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { TabBar } from '../ui/TabBar'
import { TrackedChip } from '../WorkBoard/TrackedChip'
import { PageHeader } from '../ui/PageHeader'

const TABS = [
    { id: 'overview', label: 'Overview', icon: FileText },
    { id: 'branches', label: 'Branches', icon: GitBranch },
    { id: 'releases', label: 'Releases', icon: Tag },
    { id: 'actions', label: 'Actions', icon: Zap },
    { id: 'issues', label: 'Issues', icon: CircleDot },
    { id: 'pulls', label: 'Pull Requests', icon: GitPullRequest },
    { id: 'settings', label: 'Settings', icon: Settings }
]

export function RepoDetail({ repo, onBack, onStartReview, onGenerateDescription }) {
    const [activeTab, setActiveTab] = useState('overview')
    const [repoData, setRepoData] = useState(repo)
    const [loadingRepo, setLoadingRepo] = useState(false)
    const [isStaleData, setIsStaleData] = useState(false)

    const owner = repo.owner?.login || repo.full_name?.split('/')[0]
    const repoName = repo.name
    const api = useRepoDetail(owner, repoName)

    // Fetch fresh repo data on mount
    const loadRepo = useCallback(async () => {
        setLoadingRepo(true)
        setIsStaleData(false)
        try {
            const data = await api.fetchRepo()
            setRepoData(data.data || data)
        } catch {
            // Fallback to prop data, but indicate it may be stale
            setIsStaleData(true)
        } finally {
            setLoadingRepo(false)
        }
    }, [api])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadRepo()
    }, [loadRepo])

    const r = repoData

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {isStaleData && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-sm text-amber-700 dark:text-amber-400">
                    <span>Could not refresh repo data. Showing cached version.</span>
                </div>
            )}
            {/* Header */}
            <div className="flex items-start gap-4">
                <Button variant="ghost" size="sm" onClick={onBack} className="mt-1 shrink-0">
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
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                    r.private
                                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                        : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                }`}>
                                    {r.private ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                                    {r.private ? 'Private' : 'Public'}
                                </span>
                                {r.archived && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                        Archived
                                    </span>
                                )}
                                {r.fork && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                                        <GitFork className="w-3 h-3" /> Fork
                                    </span>
                                )}
                            </>
                        }
                    />

                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {r.language && (
                            <span className="flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
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
                            className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline ml-auto">
                            View on GitHub <ExternalLink className="w-3 h-3" />
                        </a>
                    </div>

                    {r.topics?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {r.topics.map(topic => (
                                <span key={topic} className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/50">
                                    {topic}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {loadingRepo && <Spinner size="md" className="shrink-0" />}
            </div>

            {/* Tabs */}
            <TabBar
                tabs={TABS}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                variant="underline"
                layoutId="repo-detail-tabs"
                className="overflow-x-auto"
            />

            {/* Tab Content */}
            <div role="tabpanel" id={`tabpanel-repo-detail-tabs-${activeTab}`} aria-labelledby={`tab-repo-detail-tabs-${activeTab}`}>
                {activeTab === 'overview' && <OverviewTab api={api} repoData={r} />}
                {activeTab === 'branches' && <BranchesTab api={api} />}
                {activeTab === 'releases' && <ReleasesTab api={api} />}
                {activeTab === 'actions' && <ActionsTab repo={r} />}
                {activeTab === 'issues' && <IssuesTab api={api} repoFullName={`${owner}/${repoName}`} />}
                {activeTab === 'pulls' && <PullRequestsTab api={api} onStartReview={onStartReview} onGenerateDescription={onGenerateDescription} />}
                {activeTab === 'settings' && <SettingsTab owner={owner} repo={repoName} api={api} repoData={r} onUpdate={setRepoData} />}
            </div>
        </div>
    )
}
