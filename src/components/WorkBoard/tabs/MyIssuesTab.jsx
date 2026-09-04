import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { CircleDot, Clock } from 'lucide-react'
import { useMyOpenIssues } from '../../../hooks/useWorkBoard'
import { useWorkBoardFilters, applyFilters } from '../filters/filter-context-helpers'
import { SkeletonList, UpsellCard, ErrorState } from '../shared/shared-ui'
import { dayLabel } from '../shared/formatters'
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
import { WorkBoardRowLink } from '../WorkBoardRowLink'
import { Badge } from '../../ui/Badge'
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'
import { RowIconBadge } from '../../ui/RowIconBadge'

export function MyIssuesTab() {
    const { data, loading, error, refresh } = useMyOpenIssues()
    const { params } = useWorkBoardFilters()
    // Above the early returns so it stays an unconditional hook call.
    const issues = useMemo(() => applyFilters(data || [], params), [data, params])

    if (loading) return <SkeletonList count={4} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return <ErrorState error={error} what="issues" onRetry={refresh} />
    }

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
                    >
                        <WorkBoardRowLink
                            repoFullName={issue.repoFullName}
                            number={issue.issueNumber}
                            itemType="issue"
                            itemUrl={issueUrl}
                            ariaLabel={`Open issue #${issue.issueNumber} ${issue.title ? `— ${issue.title}` : ''} in app`}
                        >
                            <div className="flex items-start gap-4 p-5 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 transition-colors">
                                <RowIconBadge icon={CircleDot} tone="emerald" size="md" className="mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                                        {issue.title || `Issue #${issue.issueNumber}`}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                                        <span className="font-mono text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">{issue.repoFullName}</span>
                                        #{issue.issueNumber}
                                        {(issue.labels || []).map(label => (
                                            <Badge key={label} tone="neutral" size="xs">
                                                {label}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap flex-shrink-0">
                                    <Clock className="w-3 h-3" />
                                    {dayLabel(issue.ageDays)}
                                    <WorkBoardRowMenu
                                        repoFullName={issue.repoFullName}
                                        itemUrl={issueUrl}
                                        itemType="issue"
                                        itemNumber={issue.issueNumber}
                                    />
                                </div>
                            </div>
                        </WorkBoardRowLink>
                    </motion.div>
                )
            })}
        </div>
    )
}
