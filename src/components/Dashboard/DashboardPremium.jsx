import { useState, useMemo, useEffect, lazy, Suspense } from 'react'
import {
    BarChart3, TrendingUp, Activity, GitPullRequest,
    Zap, Heart, Users, Building2,
    Code2, Folder, Archive, Star, GitFork, CheckCircle2,
    Download,
} from 'lucide-react'
import { TodayPanel } from './TodayPanel'
import { DashboardShell } from './DashboardShell'
import { AttentionFeed } from './AttentionFeed'
// InboxPanel is code-split so it doesn't inflate the dashboard initial chunk.
// The static import of isEnabled remains — it's a tiny synchronous flag read.
const InboxPanel = lazy(() => import('./Premium/InboxPanel').then(m => ({ default: m.InboxPanel })))
import { isEnabled } from '../../lib/featureFlags'
import { CategorySection } from './CategorySection'
import { StatCard } from './StatCard'
// ActivityChart + LanguageChart pull recharts (~360 kB); split them out so
// they don't block dashboard first paint. The CategorySection wrapper renders
// a fallback skeleton on demand while the chunk loads.
const ActivityChart = lazy(() => import('./ActivityChart').then(m => ({ default: m.ActivityChart })))
const LanguageChart = lazy(() => import('./LanguageChart').then(m => ({ default: m.LanguageChart })))
import { MigrationActivity } from './MigrationActivity'
import { OrganizationCard } from './OrganizationCard'
import { shouldShowCategory, aggregateRepoStats, aggregateLanguages, calculateActivityMetrics } from '../../utils/statsAggregator'
import { useModal } from '../../hooks/useModal'
import { Skeleton } from '../ui/Skeleton'
import { RowIconBadge } from '../ui/RowIconBadge'
import { motion } from 'framer-motion'

/**
 * DashboardPremium — premium, integrated dashboard.
 *
 * Composition:
 *   <DashboardShell>          ambient backdrop + sticky TOC + cross-links
 *     <TodayPanel />          greeting + chips + WhatNeedsYou + AI promo
 *     <AttentionFeed />       (or premium Inbox behind feature flag)
 *     <CategorySection> × N   overview / migrations / health / teams / orgs
 *   </DashboardShell>
 *
 * Each section wears the same shell, exposes an `action` that bridges to
 * the matching full-feature view, and registers an anchor with the shell
 * so the right-rail TOC can scroll-spy + jump between them.
 */
export function DashboardPremium({
    user,
    stats,
    orgs = [],
    repos = [],
    teams = [],
    selectedOrg,
    onSelectOrg,
    loading,
    activity = [],
    onOrgClick,
    onTeamClick,
    onViewChange,
    onSync,
    lastSyncedAt,
}) {
    const [timeRange, setTimeRange] = useState('7d')
    const [licenseTier, setLicenseTier] = useState('free')
    const { openModal, openModalWithData } = useModal()

    useEffect(() => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') return
        const controller = new AbortController()
        fetch('/api/v1/license', { credentials: 'include', signal: controller.signal })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!data || controller.signal.aborted) return
                if (data.active && data.source === 'license_key' && data.tier) {
                    setLicenseTier(data.tier)
                }
            })
            .catch(() => { /* fall back to free copy */ })
        return () => controller.abort()
    }, [])

    const handleOpenWorkBoard = (params = {}) => {
        onViewChange?.('work-board', params)
    }

    // Aggregate repository statistics
    const repoStats = useMemo(() => aggregateRepoStats(repos), [repos])

    // Calculate activity metrics
    const activityMetrics = useMemo(() =>
        calculateActivityMetrics(activity, timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90),
        [activity, timeRange]
    )

    // Aggregate language data
    const languageData = useMemo(() => aggregateLanguages(repos), [repos])

    // Determine which categories to show
    const categories = useMemo(() => ({
        pullRequests: shouldShowCategory('pullRequests', { repos, stats }),
        issues: shouldShowCategory('issues', { repos, stats }),
        actions: shouldShowCategory('actions', { repos, stats }),
        health: shouldShowCategory('health', { repos, stats }),
        teams: shouldShowCategory('teams', { repos, stats, teams }),
        organizations: shouldShowCategory('organizations', { repos, stats, orgs }),
    }), [repos, stats, teams, orgs])

    const sourceRepoCount = useMemo(
        () => repos.filter(r => !r.fork && !r.archived).length,
        [repos],
    )

    const showHealth = categories.health && repos.length > 0
    const showTeams = categories.teams && teams.length > 0
    const showOrgs = categories.organizations && orgs.length > 1
    const showDiscover = !categories.pullRequests || !categories.actions || !categories.health

    const anchors = useMemo(() => {
        const list = [
            { id: 'today', label: 'Today' },
            { id: 'attention', label: 'Attention' },
            { id: 'overview', label: 'Overview', count: stats?.totalRepos ?? repoStats.total },
            { id: 'migrations', label: 'Migrations' },
        ]
        if (showHealth) list.push({ id: 'health', label: 'Health', count: sourceRepoCount })
        if (showTeams) list.push({ id: 'teams', label: 'Teams', count: teams.length })
        if (showOrgs) list.push({ id: 'organizations', label: 'Organizations', count: orgs.length })
        if (showDiscover) list.push({ id: 'discover', label: 'Discover' })
        return list
    }, [stats, repoStats.total, showHealth, sourceRepoCount, showTeams, teams.length, showOrgs, orgs.length, showDiscover])

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
    }

    return (
        <DashboardShell anchors={anchors} onViewChange={onViewChange}>
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-5 sm:space-y-6 lg:space-y-7"
            >
                <TodayPanel
                    user={user}
                    orgs={orgs}
                    selectedOrg={selectedOrg}
                    onSelectOrg={onSelectOrg}
                    loading={loading}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                    onSync={onSync}
                    lastSyncedAt={lastSyncedAt}
                    onOpenWorkBoard={handleOpenWorkBoard}
                    repos={repos}
                    licenseTier={licenseTier}
                    onOpenInsights={(repo) => openModalWithData('showRepoInsights', { repo })}
                />

                <div id="attention" className="scroll-mt-20">
                    {isEnabled('inbox') ? (
                        <Suspense fallback={<Skeleton variant="card" className="h-48 rounded-2xl" />}>
                            <InboxPanel onSelectItem={(item) => onViewChange?.('repos', { highlightRepoFullName: item.repoFullName })} />
                        </Suspense>
                    ) : (
                        <AttentionFeed onSelectRepo={(repoFullName) => {
                            onViewChange?.('repos', { highlightRepoFullName: repoFullName })
                        }} />
                    )}
                </div>

                {/* CATEGORY 1: Overview Essencial (Always Visible) */}
                <CategorySection
                    id="overview"
                    eyebrow="Essentials"
                    title="Overview"
                    icon={BarChart3}
                    defaultExpanded={true}
                    action={{
                        label: 'Open Work Board',
                        onClick: () => onViewChange?.('work-board'),
                    }}
                >
                    {/* Key Metrics Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-5 mb-6 lg:mb-7">
                        <StatCard
                            title="Total Repositories"
                            value={stats?.totalRepos || repoStats.total}
                            icon={Folder}
                            color="text-blue-500"
                            bg="bg-blue-500/10"
                            loading={loading}
                            onClick={() => onViewChange?.('repos')}
                            hint="View all repositories"
                        />
                        <StatCard
                            title="Public / Private"
                            value={`${stats?.publicRepos || repoStats.public} / ${stats?.privateRepos || repoStats.private}`}
                            icon={Archive}
                            color="text-purple-500"
                            bg="bg-purple-500/10"
                            loading={loading}
                            onClick={() => onViewChange?.('repos', { initialFilters: { visibility: 'public' } })}
                            hint="Filter to public repositories"
                        />
                        <StatCard
                            title="Total Stars"
                            value={repoStats.totalStars}
                            icon={Star}
                            color="text-yellow-500"
                            bg="bg-yellow-500/10"
                            loading={loading}
                            onClick={() => onViewChange?.('repos', { initialSort: 'stars' })}
                            hint="Sort repos by star count"
                        />
                        <StatCard
                            title="Organizations"
                            value={stats?.organizations || orgs.length}
                            icon={Building2}
                            color="text-emerald-500"
                            bg="bg-emerald-500/10"
                            loading={loading}
                            onClick={() => {
                                const el = document.getElementById('organizations')
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            }}
                            hint="Jump to organizations"
                        />
                        <StatCard
                            title="Total Forks"
                            value={stats?.forks || repoStats.totalForks}
                            icon={GitFork}
                            color="text-indigo-500"
                            bg="bg-indigo-500/10"
                            loading={loading}
                            onClick={() => onViewChange?.('repos', { initialSort: 'forks' })}
                            hint="Sort repos by fork count"
                        />
                        <StatCard
                            title="Commits (7d)"
                            value={activityMetrics.commits}
                            icon={Activity}
                            color="text-pink-500"
                            bg="bg-pink-500/10"
                            loading={loading}
                            onClick={() => onViewChange?.('work-board', { initialTimeRange: '7d' })}
                            hint="Open Work Board (7d window)"
                        />
                        <StatCard
                            title="Archived Repos"
                            value={repoStats.archived}
                            icon={Archive}
                            color="text-slate-500"
                            bg="bg-slate-500/10"
                            loading={loading}
                            onClick={() => onViewChange?.('repos', { initialFilters: { archived: true } })}
                            hint="Show archived repositories"
                        />
                        <StatCard
                            title="Source Repos"
                            value={repoStats.sources}
                            icon={Code2}
                            color="text-cyan-500"
                            bg="bg-cyan-500/10"
                            loading={loading}
                            onClick={() => onViewChange?.('repos', { initialFilters: { type: 'source' } })}
                            hint="Filter to source (non-fork) repos"
                        />
                    </div>

                    {/* Charts Section. Each chart is lazy-loaded (recharts ~360 kB) so
                        the dashboard first paint is faster; the Suspense fallback is a
                        plain skeleton card until the chunk arrives. */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-7">
                        <Suspense fallback={<Skeleton variant="card" className="h-[400px] rounded-2xl border border-slate-200/30 dark:border-slate-800/30" aria-hidden="true" />}>
                            <ActivityChart
                                activity={activity}
                                timeRange={timeRange}
                                loading={loading}
                            />
                        </Suspense>
                        <Suspense fallback={<Skeleton variant="card" className="h-[400px] rounded-2xl border border-slate-200/30 dark:border-slate-800/30" aria-hidden="true" />}>
                            <LanguageChart
                                data={languageData}
                                loading={loading}
                            />
                        </Suspense>
                    </div>
                </CategorySection>

                {/* CATEGORY: Migration Activity (Always visible) */}
                <CategorySection
                    id="migrations"
                    eyebrow="Pipeline"
                    title="Migration Activity"
                    icon={Download}
                    defaultExpanded={true}
                    action={{
                        label: 'View history',
                        onClick: () => openModal('showMigrationHistory'),
                    }}
                >
                    <MigrationActivity loading={loading} />
                </CategorySection>

                {/* CATEGORY 4: Health & Quality (Conditional) */}
                {showHealth && (
                    <CategorySection
                        id="health"
                        eyebrow="Quality"
                        title="Health & Quality"
                        icon={Heart}
                        count={sourceRepoCount}
                        defaultExpanded={true}
                        action={{
                            label: 'Run health check',
                            onClick: () => repos[0] && openModalWithData('showCommunityHealth', repos[0]),
                        }}
                    >
                        <HealthOverview repos={repos} openModalWithData={openModalWithData} />
                    </CategorySection>
                )}

                {/* CATEGORY 5: Teams (Conditional) */}
                {showTeams && (
                    <CategorySection
                        id="teams"
                        eyebrow="People"
                        title="Teams"
                        icon={Users}
                        count={teams.length}
                        defaultExpanded={true}
                        action={{
                            label: 'Open Teams',
                            onClick: () => onViewChange?.('teams'),
                        }}
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                            {teams.map(team => {
                                const interactive = typeof onTeamClick === 'function'
                                const className = `text-left w-full p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl transition-all ${
                                    interactive
                                        ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 hover:border-indigo-300 dark:hover:border-indigo-500/40 ds-focus-ring'
                                        : ''
                                }`
                                const inner = (
                                    <>
                                        <div className="flex items-center gap-3 mb-3">
                                            <RowIconBadge icon={Users} tone="indigo" size="lg" surface="soft" />
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-slate-900 dark:text-slate-100 truncate">
                                                    {team.name}
                                                </h3>
                                                {team.description && (
                                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                                        {team.description}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                                            <span className="flex items-center gap-1">
                                                <Users className="w-3.5 h-3.5" />
                                                {team.members?.length || 0} members
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Folder className="w-3.5 h-3.5" />
                                                {team.repos?.length || 0} repos
                                            </span>
                                        </div>
                                    </>
                                )
                                return interactive ? (
                                    <motion.button
                                        type="button"
                                        key={team.id}
                                        className={className}
                                        onClick={() => onTeamClick(team)}
                                        aria-label={`Open team ${team.name}`}
                                    >
                                        {inner}
                                    </motion.button>
                                ) : (
                                    <motion.div key={team.id} className={className}>
                                        {inner}
                                    </motion.div>
                                )
                            })}
                        </div>
                    </CategorySection>
                )}

                {/* CATEGORY 6: Organizations (Conditional) */}
                {showOrgs && (
                    <div data-section="organizations">
                        <CategorySection
                            id="organizations"
                            eyebrow="Workspaces"
                            title="Organizations"
                            icon={Building2}
                            count={orgs.length}
                            defaultExpanded={true}
                            action={{
                                label: 'Browse all repos',
                                onClick: () => onViewChange?.('repos'),
                            }}
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                                {orgs.map(org => (
                                    <OrganizationCard
                                        key={org.login}
                                        org={org}
                                        repos={repos}
                                        onClick={onOrgClick}
                                    />
                                ))}
                            </div>
                        </CategorySection>
                    </div>
                )}

                {/* Discover More Features Section */}
                {showDiscover && (
                    <CategorySection
                        id="discover"
                        eyebrow="What's next"
                        title="Discover More Features"
                        icon={TrendingUp}
                        defaultExpanded={false}
                        tone="neutral"
                    >
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                            {!categories.actions && (
                                <DiscoverCard
                                    icon={Zap}
                                    title="Set up GitHub Actions"
                                    description="Automate your workflows with CI/CD pipelines"
                                    href="https://docs.github.com/actions"
                                />
                            )}
                            {!categories.health && repos.length > 0 && (
                                <DiscoverCard
                                    icon={Heart}
                                    title="Analyze Repository Health"
                                    description="Improve your project's community standards"
                                    actionText="Run Health Check"
                                    onClick={() => openModalWithData('showCommunityHealth', repos[0])}
                                />
                            )}
                            {!categories.pullRequests && (
                                <DiscoverCard
                                    icon={GitPullRequest}
                                    title="Enable Pull Requests"
                                    description="Start collaborating with your team"
                                />
                            )}
                        </div>
                    </CategorySection>
                )}
            </motion.div>
        </DashboardShell>
    )
}

/**
 * HealthOverview - Shows top repos with quick health check buttons
 */
function HealthOverview({ repos, openModalWithData }) {
    // Filter once, derive both the top-6 cards and the total count from the
    // same source list so we don't traverse `repos` twice per render.
    const { topRepos, totalRepos } = useMemo(() => {
        const eligible = repos.filter(r => !r.fork && !r.archived)
        const sorted = [...eligible].sort(
            (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0),
        )
        return { topRepos: sorted.slice(0, 6), totalRepos: eligible.length }
    }, [repos])

    return (
        <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex flex-wrap items-center gap-3 px-1">
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span><strong>{totalRepos}</strong> source repos available for health analysis</span>
                </div>
                <span className="text-xs text-slate-400 dark:text-slate-500">Click any repo to run a full health check</span>
            </div>

            {/* Repo grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {topRepos.map(repo => (
                    <motion.button
                        key={repo.id}
                        type="button"
                        onClick={() => openModalWithData('showCommunityHealth', repo)}
                        className="flex items-center gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 hover:border-emerald-300 dark:hover:border-emerald-500/40 text-left transition-all group ds-focus-ring"
                    >
                        <RowIconBadge icon={Heart} tone="emerald" size="lg" surface="soft" />
                        <div className="min-w-0 flex-1">
                            <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                                {repo.name}
                            </h4>
                            <div className="flex items-center gap-2 mt-0.5">
                                {repo.language && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">{repo.language}</span>
                                )}
                                {repo.stargazers_count > 0 && (
                                    <span className="flex items-center gap-0.5 text-xs text-slate-400 dark:text-slate-500">
                                        <Star className="w-3 h-3" /> {repo.stargazers_count}
                                    </span>
                                )}
                            </div>
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-emerald-500 dark:group-hover:text-emerald-400 transition-colors shrink-0" />
                    </motion.button>
                ))}
            </div>

            {/* Show more hint */}
            {totalRepos > 6 && (
                <p className="text-xs text-center text-slate-400 dark:text-slate-500 pt-1">
                    Showing top 6 of {totalRepos} repos. Run individual health checks from the Repositories view.
                </p>
            )}
        </div>
    )
}

/**
 * DiscoverCard - Small card for features without data
 */
function DiscoverCard({ icon: Icon, title, description, href, actionText, onClick }) {
    const isLink = !!href
    const ActionTag = isLink ? 'a' : 'button'
    const actionProps = isLink
        ? { href, target: '_blank', rel: 'noopener noreferrer' }
        : { type: 'button', onClick }

    return (
        <motion.div
            className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-colors"
        >
            <Icon className="w-8 h-8 text-indigo-500 mb-3" />
            <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-2">
                {title}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                {description}
            </p>
            {(href || actionText) && (
                <ActionTag
                    {...actionProps}
                    className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer ds-focus-ring rounded"
                >
                    {actionText || 'Learn More'} →
                </ActionTag>
            )}
        </motion.div>
    )
}
