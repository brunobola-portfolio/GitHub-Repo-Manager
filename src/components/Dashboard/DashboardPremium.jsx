import { useState, useMemo, useEffect } from 'react'
import {
    BarChart3, TrendingUp, Activity, GitPullRequest, GitMerge,
    Zap, Heart, Users, Building2,
    Code2, Folder, Archive, Star, GitFork, CheckCircle2, XCircle,
    Download, Sparkles, MessageCircle, ArrowRight
} from 'lucide-react'
import { CategorySection } from './CategorySection'
import { StatCard } from './StatCard'
import { ActivityChart } from './ActivityChart'
import { LanguageChart } from './LanguageChart'
import { MigrationActivity } from './MigrationActivity'
import { OrganizationSelector } from './OrganizationSelector'
import { OrganizationCard } from './OrganizationCard'
import { shouldShowCategory, aggregateRepoStats, aggregateLanguages, calculateActivityMetrics } from '../../utils/statsAggregator'
import { useModal } from '../../hooks/useModal'
import { motion } from 'framer-motion'

/**
 * DashboardPremium - Comprehensive dashboard with category-based organization
 * Shows aggregated data from all repos, organizations, teams, actions, and health metrics
 */
export function DashboardPremium({
    stats,
    orgs = [],
    repos = [],
    teams = [],
    selectedOrg,
    onSelectOrg,
    loading,
    activity = [],
    onOrgClick
}) {
    const [timeRange, setTimeRange] = useState('7d')
    const [licenseTier, setLicenseTier] = useState('free')
    const { openModalWithData } = useModal()

    useEffect(() => {
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

    const aiBannerCopy = useMemo(() => {
        if (licenseTier === 'enterprise') {
            return {
                title: 'Your AI tools — included in Enterprise',
                body: 'Ask the Assistant anything, run insights on a repo, or get a migration risk report.',
            }
        }
        if (licenseTier === 'pro') {
            return {
                title: 'Your AI tools — included in Pro',
                body: 'Ask the Assistant anything, run insights on a repo, or get a migration risk report.',
            }
        }
        return {
            title: 'Try the AI product — free',
            body: 'Ask the Assistant anything, run insights on a repo, or get a migration risk report. No upgrade required.',
        }
    }, [licenseTier])

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
            {/* Header with Organization Selector */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 sm:gap-6">
                <div className="flex-1">
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight ds-font-display ds-gradient-text">
                        Dashboard
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1.5 sm:mt-2 text-base sm:text-lg ds-font-display">
                        Comprehensive overview of your GitHub ecosystem
                    </p>
                </div>

                {/* Organization Selector */}
                <div className="lg:self-start">
                    <div className="mb-2">
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                            Filter by Organization
                        </label>
                    </div>
                    <OrganizationSelector
                        orgs={orgs}
                        selectedOrg={selectedOrg}
                        onSelectOrg={onSelectOrg}
                        loading={loading}
                    />
                </div>
            </div>

            {/* AI Quick-Start CTA — surfaces the free-tier AI product so new users
                discover Assistant + Insights without having to click into a repo.
                Collapses to nothing on empty repos (the RepoList empty state already
                handles first-run guidance). */}
            {repos.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="relative overflow-hidden rounded-2xl border border-indigo-200/50 dark:border-indigo-500/20 bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-indigo-500/10 dark:via-slate-900/40 dark:to-purple-500/10 p-5 sm:p-6"
                >
                    <div className="absolute inset-0 pointer-events-none opacity-[0.04] dark:opacity-[0.08]"
                        style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(99,102,241,0.6), transparent 50%), radial-gradient(circle at 80% 80%, rgba(139,92,246,0.5), transparent 50%)' }}
                        aria-hidden="true"
                    />
                    <div className="relative flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/30">
                            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 ds-font-display">
                                {aiBannerCopy.title}
                            </h2>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                                {aiBannerCopy.body}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 flex-shrink-0">
                            <button
                                onClick={() => {
                                    // Open the floating AI Assistant if mounted — the FAB listens on this event
                                    window.dispatchEvent(new CustomEvent('ai-assistant:open'))
                                }}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 transition-colors"
                            >
                                <MessageCircle className="w-3.5 h-3.5" />
                                Open Assistant
                            </button>
                            {repos.length > 0 && (
                                <button
                                    onClick={() => openModalWithData('showRepoInsights', { repo: repos[0] })}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-lg hover:shadow-indigo-500/30 transition-all"
                                >
                                    Get Insights
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                </motion.div>
            )}

            {/* CATEGORY 1: Overview Essencial (Always Visible) */}
            <CategorySection
                title="Overview"
                icon={BarChart3}
                defaultExpanded={true}
            >
                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-6 lg:mb-8">
                    <StatCard
                        title="Total Repositories"
                        value={stats?.totalRepos || repoStats.total}
                        icon={Folder}
                        color="text-blue-500"
                        bg="bg-blue-500/10"
                        loading={loading}
                    />
                    <StatCard
                        title="Public / Private"
                        value={`${stats?.publicRepos || repoStats.public} / ${stats?.privateRepos || repoStats.private}`}
                        icon={Archive}
                        color="text-purple-500"
                        bg="bg-purple-500/10"
                        loading={loading}
                    />
                    <StatCard
                        title="Total Stars"
                        value={repoStats.totalStars}
                        icon={Star}
                        color="text-yellow-500"
                        bg="bg-yellow-500/10"
                        loading={loading}
                    />
                    <StatCard
                        title="Organizations"
                        value={stats?.organizations || orgs.length}
                        icon={Building2}
                        color="text-emerald-500"
                        bg="bg-emerald-500/10"
                        loading={loading}
                    />
                    <StatCard
                        title="Total Forks"
                        value={stats?.forks || repoStats.totalForks}
                        icon={GitFork}
                        color="text-indigo-500"
                        bg="bg-indigo-500/10"
                        loading={loading}
                    />
                    <StatCard
                        title="Commits (7d)"
                        value={activityMetrics.commits}
                        icon={Activity}
                        color="text-pink-500"
                        bg="bg-pink-500/10"
                        loading={loading}
                    />
                    <StatCard
                        title="Archived Repos"
                        value={repoStats.archived}
                        icon={Archive}
                        color="text-slate-500"
                        bg="bg-slate-500/10"
                        loading={loading}
                    />
                    <StatCard
                        title="Source Repos"
                        value={repoStats.sources}
                        icon={Code2}
                        color="text-cyan-500"
                        bg="bg-cyan-500/10"
                        loading={loading}
                    />
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
                    <ActivityChart
                        activity={activity}
                        timeRange={timeRange}
                        onTimeRangeChange={setTimeRange}
                        loading={loading}
                    />
                    <LanguageChart
                        data={languageData}
                        loading={loading}
                    />
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
                        {teams.map(team => (
                            <motion.div
                                key={team.id}
                                whileHover={{ y: -3 }}
                                className="p-5 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/40 dark:border-slate-800/40 rounded-xl hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-xl focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-inset transition-all"
                            >
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
                            </motion.div>
                        ))}
                    </div>
                </CategorySection>
            )}

            {/* CATEGORY 6: Organizations (Conditional) */}
            {categories.organizations && orgs.length > 1 && (
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
                        whileHover={{ y: -2 }}
                        onClick={() => openModalWithData('showCommunityHealth', repo)}
                        className="flex items-center gap-3 p-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/40 dark:border-slate-800/40 rounded-xl hover:border-emerald-300 dark:hover:border-emerald-500/50 hover:shadow-lg text-left transition-all group"
                    >
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 flex items-center justify-center shrink-0 group-hover:from-emerald-500/20 group-hover:to-teal-500/20 transition-colors">
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
            whileHover={{ y: -3 }}
            className="p-6 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-slate-200/40 dark:border-slate-800/40 rounded-xl hover:border-indigo-300 dark:hover:border-indigo-500/50 hover:shadow-xl transition-all"
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
