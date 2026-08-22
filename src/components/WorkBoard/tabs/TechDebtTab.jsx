import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Clock, Wrench, Flame } from 'lucide-react'
import { useTechDebt } from '../../../hooks/useWorkBoard'
import { useWorkBoardFilters, applyFilters } from '../filters/filter-context-helpers'
import { SkeletonList, UpsellCard, ErrorState } from '../shared/shared-ui'
import { dayLabel } from '../shared/formatters'
import { WorkBoardRowMenu } from '../WorkBoardRowMenu'
import { WorkBoardRowLink } from '../WorkBoardRowLink'
import { Badge } from '../../ui/Badge'
import { EmptyStateDiscovery } from '../EmptyStateDiscovery'
import { Card } from '../../ui/Card'
import { RowIconBadge } from '../../ui/RowIconBadge'

export function TechDebtTab() {
    const { data, loading, error, refresh } = useTechDebt()
    const { params } = useWorkBoardFilters()
    // Above the early returns so it stays an unconditional hook call.
    const items = useMemo(() => applyFilters(data?.items || [], params), [data, params])

    if (loading) return <SkeletonList count={5} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return <ErrorState error={error} what="tech debt" onRetry={refresh} />
    }

    const hotspots = data?.hotspots || []

    if (items.length === 0) {
        return (
            <EmptyStateDiscovery
                icon={Wrench}
                plainTitle="No tech debt tracked"
                plainSubtitle="Label issues with tech-debt, refactor, debt or cleanup and they'll appear here across all repos."
            />
        )
    }

    return (
        <div className="space-y-4 p-4">
            {/* Hotspots */}
            {hotspots.length > 0 && (
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40">
                    <div className="flex items-center gap-2 mb-2">
                        <Flame className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                            Hotspots
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {hotspots.slice(0, 6).map(h => (
                            <span
                                key={h.repoFullName}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-900/60 text-xs font-medium text-slate-700 dark:text-slate-200"
                            >
                                <span className="font-mono text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">{h.repoFullName}</span>
                                <span className="text-amber-700 dark:text-amber-400 font-semibold">{h.count}</span>
                                {h.oldestAgeDays > 0 && (
                                    <span className="text-slate-400 ds-text-micro">· oldest {Math.round(h.oldestAgeDays)}d</span>
                                )}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Issues */}
            <Card glass={false} shadow="none" className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {items.map((issue, i) => {
                    const issueUrl = `https://github.com/${issue.repoFullName}/issues/${issue.issueNumber}`
                    return (
                        <motion.div
                            key={`${issue.repoFullName}-${issue.issueNumber}`}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(i * 0.02, 0.3) }}
                        >
                            <WorkBoardRowLink
                                repoFullName={issue.repoFullName}
                                number={issue.issueNumber}
                                itemType="issue"
                                itemUrl={issueUrl}
                                ariaLabel={`Open tech-debt issue #${issue.issueNumber} ${issue.title ? `— ${issue.title}` : ''} in app`}
                            >
                                <div className="flex items-start gap-4 p-5 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 transition-colors bg-white/60 dark:bg-slate-900/40">
                                    <RowIconBadge icon={Wrench} tone="amber" size="md" className="mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                                            {issue.title || `Issue #${issue.issueNumber}`}
                                        </div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                                            <span className="font-mono text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">{issue.repoFullName}</span>
                                            #{issue.issueNumber}
                                            {(issue.labels || []).slice(0, 3).map(label => (
                                                <Badge key={label} tone="neutral" size="xs">
                                                    {label}
                                                </Badge>
                                            ))}
                                            {issue.assignees?.length > 0 && (
                                                <span className="ds-text-micro text-slate-400">
                                                    → {issue.assignees.slice(0, 2).join(', ')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium whitespace-nowrap flex-shrink-0">
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
            </Card>
        </div>
    )
}
