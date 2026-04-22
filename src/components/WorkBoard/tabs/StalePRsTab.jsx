import { useState } from 'react'
import { motion } from 'framer-motion'
import { GitPullRequest, ExternalLink, Clock, AlertTriangle } from 'lucide-react'
import { useStalePRs } from '../../../hooks/useWorkBoard'
import { useWorkBoardFilters, applyFilters } from '../filters/filter-context-helpers'
import { useReviewAction } from '../../../hooks/useReviewAction'
import { InlineActions } from '../InlineActions'
import { SkeletonList, EmptyState, WebhookHint, UpsellCard } from '../shared/shared-ui'
import { dayLabel } from '../shared/formatters'

export function StalePRsTab() {
    const [staleAfterDays, setStaleAfterDays] = useState(7)
    const { data, loading, error, refresh } = useStalePRs({ staleAfterDays })
    const { params } = useWorkBoardFilters()
    const [optimisticallyRemoved, setOptimisticallyRemoved] = useState(() => new Set())
    const actions = useReviewAction({
        onOptimistic: (_action, args) => {
            setOptimisticallyRemoved(prev => {
                const next = new Set(prev)
                next.add(`${args.repoFullName}#${args.prNumber}`)
                return next
            })
        },
        onRollback: (_action, args) => {
            setOptimisticallyRemoved(prev => {
                const next = new Set(prev)
                next.delete(`${args.repoFullName}#${args.prNumber}`)
                return next
            })
        },
    })

    if (loading) return <SkeletonList count={6} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load stale PRs. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const filtered = applyFilters(data || [], params)
    const prs = filtered.filter(p => !optimisticallyRemoved.has(`${p.repoFullName}#${p.prNumber}`))

    return (
        <>
            {/* Controls */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800/60">
                <label htmlFor="stale-prs-after-days" className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    Stale after
                </label>
                <select
                    id="stale-prs-after-days"
                    value={staleAfterDays}
                    onChange={e => setStaleAfterDays(Number(e.target.value))}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                    {[3, 7, 14, 30].map(d => (
                        <option key={d} value={d}>{d} days</option>
                    ))}
                </select>
            </div>

            {prs.length === 0 ? (
                <>
                    <EmptyState
                        icon={GitPullRequest}
                        title={`No PRs open for more than ${staleAfterDays} days`}
                        subtitle="Your team is on top of it!"
                    />
                    <WebhookHint />
                </>
            ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {prs.map((pr, i) => (
                        <motion.a
                            key={`${pr.repoFullName}-${pr.prNumber}`}
                            href={`https://github.com/${pr.repoFullName}/pull/${pr.prNumber}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.03 }}
                            className="flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                        >
                            <div className="mt-0.5 p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex-shrink-0">
                                <AlertTriangle className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                    {pr.title || `PR #${pr.prNumber}`}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    <span className="font-mono text-indigo-600 dark:text-indigo-400">{pr.repoFullName}</span>
                                    {' '}#{pr.prNumber}
                                    {pr.authorLogin && <> by <strong>{pr.authorLogin}</strong></>}
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap flex-shrink-0">
                                <Clock className="w-3 h-3" />
                                {dayLabel(pr.ageDays)}
                                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <InlineActions
                                onSnooze={(hours) => actions.snooze({ repoFullName: pr.repoFullName, prNumber: pr.prNumber, hours })}
                            />
                        </motion.a>
                    ))}
                </div>
            )}
        </>
    )
}
