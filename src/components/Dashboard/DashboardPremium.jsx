import { useState, useMemo, useEffect, lazy, Suspense } from 'react'
import {
    BarChart3, TrendingUp, Activity, GitPullRequest,
    Zap, Heart, Users, Building2,
    Code2, Folder, Archive, Star, GitFork, CheckCircle2,
    Download
} from 'lucide-react'
import { DashboardHero } from './DashboardHero'
import { AIPromoStrip } from './AIPromoStrip'
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
import { motion } from 'framer-motion'

/**
 * DashboardPremium - Comprehensive dashboard with category-based organization
 * Shows aggregated data from all repos, organizations, teams, actions, and health metrics
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
    const { openModalWithData } = useModal()

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
    const categories = {
        pullRequests: shouldShowCategory('pullRequests', { repos, stats }),
        issues: shouldShowCategory('issues', { repos, stats }),
        actions: shouldShowCategory('actions', { repos, stats }),
        health: shouldShowCategory('health', { repos, stats }),
        teams: shouldShowCategory('teams', { repos, stats, teams }),
        organizations: shouldShowCategory('organizations', { repos, stats, orgs })
    }

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    }

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-5 sm:space-y-6 lg:space-y-8"
        >
            <DashboardHero
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
            />

            <AIPromoStrip
                repos={repos}
                licenseTier={licenseTier}
                onOpenInsights={(repo) => openModalWithData('showRepoInsights', { repo })}
            />

            {isEnabled('inbox') ? (
                <Suspense fallback={<div className="h-48 animate-pulse bg-zinc-100 dark:bg-zinc-900/40 rounded-2xl" />}>
                    <InboxPanel onSelectItem={(item) => onViewChange?.('repos', { highlightRepoFullName: item.repoFullName })} />
                </Suspense>
            ) : (
                <AttentionFeed onSelectRepo={(repoFullName) => {
                    onViewChange?.('repos', { highlightRepoFullName: repoFullName })
                }} />
            )}

            {/* CATEGORY 1: Overview Essencial (Always Visible) */}
            <CategorySection
                title="Overview"
                icon={BarChart3}
                defaultExpanded={true}
            >
                {/* Key Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-6 lg:mb-8">
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
                            // Smooth-scroll the dashboard to the Organizations section.
                            const el = document.querySelector('[data-section="organizations"]')
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
                    <Suspense fallback={<div className="h-[400px] rounded-2xl bg-white/40 dark:bg-slate-900/40 border border-slate-200/30 dark:border-slate-800/30 animate-pulse" aria-hidden="true" />}>
                        <ActivityChart
                            activity={activity}
                            timeRange={timeRange}
                            loading={loading}
                        />
                    </Suspense>
                    <Suspense fallback={<div className="h-[400px] rounded-2xl bg-white/40 dark:bg-slate-900/40 border border-slate-200/30 dark:border-slate-800/30 animate-pulse" aria-hidden="true" />}>
                        <LanguageChart
                            data={languageData}
                            loading={loading}
                        />
                    </Suspense>
                </div>
            </CategorySection>

            {/* CATEGORY: Migration Activity (Always visible) */}
            <CategorySection
                title="Migration Activity"
                icon={Download}
                defaultExpanded={true}
            >
                <MigrationActivity loading={loading} />
            </CategorySection>

            {/* CATEGORY 4: Health & Quality (Conditional) */}
            {categories.health && repos.length > 0 && (
                <CategorySection
                    title="Health & Quality"
                    icon={Heart}
                    defaultExpanded={true}
                >
                    <HealthOverview repos={repos} openModalWithData={openModalWithData} />
                </CategorySection>
            )}

            {/* CATEGORY 5: Teams (Conditional) */}
            {categories.teams && teams.length > 0 && (
                <CategorySection
                    title="Teams"
                    icon={Users}
                    badge={`${teams.length} teams`}
                    defaultExpanded={true}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                        {teams.map(team => {
                            const interactive = typeof onTeamClick === 'function'
                            const className = `text-left w-full p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl transition-all ${
                                interactive
                                    ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 ds-focus-ring'
                                    : ''
                            }`
                            const inner = (
                                <>
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                                            <Users className="w-5 h-5 text-indigo-500" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-bold text-slate-900 dark:text-white truncate">
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
            {categories.organizations && orgs.length > 1 && (
                <div data-section="organizations">
                <CategorySection
                    title="Organizations"
                    icon={Building2}
                    badge={`${orgs.length} orgs`}
                    defaultExpanded={true}
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
            {(!categories.pullRequests || !categories.actions || !categories.health) && (
                <CategorySection
                    title="Discover More Features"
                    icon={TrendingUp}
                    defaultExpanded={false}
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
    )
}

/**
 * HealthOverview - Shows top repos with quick health check buttons
 */
function HealthOverview({ repos, openModalWithData }) {
    // Pick up to 6 repos sorted by stars (most popular first)
    const topRepos = useMemo(() =>
        [...repos]
            .filter(r => !r.fork && !r.archived)
            .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
            .slice(0, 6),
        [repos]
    )

    const totalRepos = repos.filter(r => !r.fork && !r.archived).length

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
                        className="flex items-center gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left transition-all group"
                    >
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                            <Heart className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
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
            className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all"
        >
            <Icon className="w-8 h-8 text-indigo-500 mb-3" />
            <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                {title}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                {description}
            </p>
            {(href || actionText) && (
                <ActionTag
                    {...actionProps}
                    className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                    {actionText || 'Learn More'} →
                </ActionTag>
            )}
        </motion.div>
    )
}
