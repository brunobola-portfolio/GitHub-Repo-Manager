import { motion } from 'framer-motion'
import { CircleDot, ExternalLink, Clock } from 'lucide-react'
import { useMyOpenIssues } from '../../../hooks/useWorkBoard'
import { useWorkBoardFilters, applyFilters } from '../filters/filter-context-helpers'
import { SkeletonList, UpsellCard } from '../shared/shared-ui'
import { dayLabel } from '../shared/formatters'
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'

export function MyIssuesTab() {
    const { data, loading, error, refresh } = useMyOpenIssues()
    const { params } = useWorkBoardFilters()

    if (loading) return <SkeletonList count={4} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load issues. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const issues = applyFilters(data || [], params)
    if (issues.length === 0) {
        return (
            <EmptyStateDiscovery
                icon={CircleDot}
                plainTitle="No open issues assigned to you"
                plainSubtitle="Nothing on your plate right now."
            />
        )
    }

    return (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {issues.map((issue, i) => {
                const issueUrl = `https://github.com/${issue.repoFullName}/issues/${issue.issueNumber}`
                return (
                    <motion.div
                        key={`${issue.repoFullName}-${issue.issueNumber}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="group flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                        <div className="mt-0.5 p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                            <CircleDot className="w-4 h-4" />
                        </div>
                        <a
                            href={issueUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 min-w-0"
                        >
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {issue.title || `Issue #${issue.issueNumber}`}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-indigo-600 dark:text-indigo-400">{issue.repoFullName}</span>
                                #{issue.issueNumber}
                                {(issue.labels || []).map(label => (
                                    <span
                                        key={label}
                                        className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-medium"
                                    >
                                        {label}
                                    </span>
                                ))}
                            </div>
                        </a>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                            <Clock className="w-3 h-3" />
                            {dayLabel(issue.ageDays)}
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <WorkBoardRowMenu repoFullName={issue.repoFullName} itemUrl={issueUrl} />
                        </div>
                    </motion.div>
                )
            })}
        </div>
    )
}
