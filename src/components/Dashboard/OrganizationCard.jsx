import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Building2, Star, GitFork, GitPullRequest, AlertCircle, Lock, Globe, TrendingUp } from 'lucide-react'
import { TAP } from '../ui/motion'
import { Card } from '../ui/Card'
import { formatCompact } from '../../utils/format'
import { MS_PER_DAY } from '../../utils/time'

/**
 * OrganizationCard - Rich card showing organization details and metrics
 */
export const OrganizationCard = memo(function OrganizationCard({ org, repos = [], onClick }) {
    // Derive all org-specific stats in a single useMemo keyed on stable deps
    const { orgRepos, totalStars, totalForks, openIssues, publicCount, privateCount, hasRecentActivity } = useMemo(() => {
        const filtered = repos.filter(r => r.owner?.login === org.login)
        // Static timestamp for purity; in a real app this might be passed as a prop
        // To ensure purity and avoid re-calculating 'now' on every render,
        // it's best to either pass it as a prop or derive it from a stable source.
        // For this component, it's used within useMemo, so it's already stable per memoization.
        const now = new Date().setHours(0, 0, 0, 0) 
        return {
            orgRepos: filtered,
            totalStars: filtered.reduce((sum, r) => sum + (r.stargazers_count || 0), 0),
            totalForks: filtered.reduce((sum, r) => sum + (r.forks_count || 0), 0),
            openIssues: filtered.reduce((sum, r) => sum + (r.open_issues_count || 0), 0),
            publicCount: filtered.filter(r => !r.private).length,
            privateCount: filtered.filter(r => r.private).length,
            hasRecentActivity: filtered.some(r => {
                const daysSinceUpdate = (now - new Date(r.updated_at).getTime()) / MS_PER_DAY
                return daysSinceUpdate < 7
            })
        }
    }, [repos, org.login])

    return (
        <motion.button
            onClick={() => onClick?.(org.login)}
            whileTap={TAP}
            className="group block w-full rounded-2xl ds-focus-ring text-left"
        >
            <Card hover className="p-6">

            {/* Header */}
            <div>
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="relative">
                            <img
                                src={org.avatar_url}
                                alt={org.login}
                                loading="lazy"
                                decoding="async"
                                className="w-14 h-14 rounded-2xl ring-2 ring-slate-200 dark:ring-slate-700 shadow-sm"
                            />
                            {hasRecentActivity && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900 shadow-sm">
                                    <div className="w-full h-full bg-emerald-500 rounded-full" />
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-base text-slate-900 dark:text-slate-100 truncate ds-font-display">
                                {org.login}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                    {orgRepos.length} {orgRepos.length === 1 ? 'repo' : 'repos'}
                                </span>
                                {hasRecentActivity && (
                                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
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
                        color="text-brand-500"
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
                            <Globe className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
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
            </Card>
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
        <div className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60">
            <div className={`w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center ${color}`}>
                <Icon className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {value}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {label}
                </p>
            </div>
        </div>
    )
})
