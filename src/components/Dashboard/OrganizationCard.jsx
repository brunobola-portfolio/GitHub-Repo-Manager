import React, { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Building2, Star, GitFork, GitPullRequest, AlertCircle, Lock, Globe, TrendingUp } from 'lucide-react'
import { formatCompact } from '../../utils/format'

/**
 * OrganizationCard - Rich card showing organization details and metrics
 */
export const OrganizationCard = memo(function OrganizationCard({ org, repos = [], onClick }) {
    // Derive all org-specific stats in a single useMemo keyed on stable deps
    const { orgRepos, totalStars, totalForks, openIssues, publicCount, privateCount, hasRecentActivity } = useMemo(() => {
        const filtered = repos.filter(r => r.owner?.login === org.login)
        const now = Date.now()
        return {
            orgRepos: filtered,
            totalStars: filtered.reduce((sum, r) => sum + (r.stargazers_count || 0), 0),
            totalForks: filtered.reduce((sum, r) => sum + (r.forks_count || 0), 0),
            openIssues: filtered.reduce((sum, r) => sum + (r.open_issues_count || 0), 0),
            publicCount: filtered.filter(r => !r.private).length,
            privateCount: filtered.filter(r => r.private).length,
            hasRecentActivity: filtered.some(r => {
                const daysSinceUpdate = (now - new Date(r.updated_at).getTime()) / (1000 * 60 * 60 * 24)
                return daysSinceUpdate < 7
            })
        }
    }, [repos, org.login])

    return (
        <motion.button
            onClick={() => onClick?.(org.login)}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.98 }}
            className="group relative w-full p-6 bg-gradient-to-br from-white/70 to-slate-50/70 dark:from-slate-900/70 dark:to-slate-800/70 backdrop-blur-xl border-2 border-slate-200/60 dark:border-slate-700/50 rounded-3xl hover:shadow-2xl hover:border-indigo-300/60 dark:hover:border-indigo-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset focus-visible:border-indigo-400 dark:focus-visible:border-indigo-500 transition-all duration-300 text-left overflow-hidden ds-card-shimmer"
        >
            {/* Gradient overlay on hover */}
            <motion.div
                className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 to-purple-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                    backgroundImage: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(168, 85, 247, 0.05))'
                }}
            />

            {/* Content */}
            <div className="relative z-10">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="relative">
                            <img
                                src={org.avatar_url}
                                alt={org.login}
                                className="w-14 h-14 rounded-2xl ring-2 ring-slate-200 dark:ring-slate-700 shadow-md group-hover:ring-indigo-300 dark:group-hover:ring-indigo-500/50 transition-all"
                            />
                            {hasRecentActivity && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900 shadow-sm">
                                    <div className="w-full h-full bg-emerald-500 rounded-full animate-ping opacity-75" />
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-lg text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors ds-font-display">
                                {org.login}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                    {orgRepos.length} {orgRepos.length === 1 ? 'repo' : 'repos'}
                                </span>
                                {hasRecentActivity && (
                                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                        <TrendingUp className="w-3 h-3" />
                                        Active
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <StatItem
                        icon={Star}
                        value={formatCompact(totalStars)}
                        label="Stars"
                        color="text-amber-500"
                    />
                    <StatItem
                        icon={GitFork}
                        value={formatCompact(totalForks)}
                        label="Forks"
                        color="text-blue-500"
                    />
                    <StatItem
                        icon={GitPullRequest}
                        value={formatCompact(openIssues)}
                        label="Open Issues"
                        color="text-teal-500"
                    />
                    <StatItem
                        icon={AlertCircle}
                        value={orgRepos.filter(r => r.has_issues).length}
                        label="With Issues"
                        color="text-rose-500"
                    />
                </div>

                {/* Repo Type Badges */}
                <div className="flex items-center gap-2 flex-wrap">
                    {publicCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg">
                            <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                                {publicCount} Public
                            </span>
                        </div>
                    )}
                    {privateCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                            <Lock className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                {privateCount} Private
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </motion.button>
    )
}, (prevProps, nextProps) => {
    // Only re-render if org or repos changed
    return (
        prevProps.org.login === nextProps.org.login &&
        prevProps.org.avatar_url === nextProps.org.avatar_url &&
        prevProps.repos.length === nextProps.repos.length
    )
})

const StatItem = memo(function StatItem({ icon: Icon, value, label, color }) {
    return (
        <div className="flex items-center gap-2 p-2 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl border border-slate-200/40 dark:border-slate-700/40">
            <div className={`w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center ${color}`}>
                <Icon className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {value}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {label}
                </p>
            </div>
        </div>
    )
})
