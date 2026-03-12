import React, { useState, useMemo } from 'react'
import {
    BarChart3, TrendingUp, Activity, GitPullRequest, GitMerge,
    MessageSquare, Zap, PlayCircle, Heart, Users, Building2,
    Code2, Folder, Archive, Star, GitFork, CheckCircle2, XCircle
} from 'lucide-react'
import { CategorySection } from './CategorySection'
import { EmptyState } from '../ui/EmptyState'
import { StatCard } from './StatCard'
import { ActivityChart } from './ActivityChart'
import { LanguageChart } from './LanguageChart'
import { OrganizationSelector } from './OrganizationSelector'
import { OrganizationCard } from './OrganizationCard'
import { shouldShowCategory, aggregateRepoStats, aggregateLanguages, calculateActivityMetrics } from '../../utils/statsAggregator'
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

            {/* CATEGORY 2: Code & Collaboration (Conditional) */}
            {categories.pullRequests && (
                <CategorySection
                    title="Code & Collaboration"
                    icon={GitMerge}
                    defaultExpanded={true}
                >
                    <EmptyState
                        icon={GitPullRequest}
                        title="Pull Request Analytics Coming Soon"
                        description="Track PR velocity, review status, and top contributors across all your repositories."
                        gradient="from-pink-500 to-rose-600"
                    />
                </CategorySection>
            )}

            {/* CATEGORY 3: CI/CD & Automation (Conditional) */}
            {categories.actions && (
                <CategorySection
                    title="CI/CD & Automation"
                    icon={Zap}
                    defaultExpanded={true}
                >
                    <EmptyState
                        icon={PlayCircle}
                        title="GitHub Actions Dashboard Coming Soon"
                        description="Monitor workflow success rates, execution times, and build trends across your projects."
                        gradient="from-indigo-500 to-blue-600"
                    />
                </CategorySection>
            )}

            {/* CATEGORY 4: Health & Quality (Conditional) */}
            {categories.health && (
                <CategorySection
                    title="Health & Quality"
                    icon={Heart}
                    defaultExpanded={true}
                >
                    <EmptyState
                        icon={CheckCircle2}
                        title="Repository Health Overview Coming Soon"
                        description="View community health scores, missing files, and improvement recommendations."
                        gradient="from-emerald-500 to-teal-600"
                    />
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
                        {!categories.health && (
                            <DiscoverCard
                                icon={Heart}
                                title="Analyze Repository Health"
                                description="Improve your project's community standards"
                                actionText="Run Health Check"
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
 * DiscoverCard - Small card for features without data
 */
function DiscoverCard({ icon: Icon, title, description, href, actionText }) {
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
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                    {actionText || 'Learn More'} →
                </a>
            )}
        </motion.div>
    )
}
