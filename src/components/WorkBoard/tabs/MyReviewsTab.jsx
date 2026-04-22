import { useState } from 'react'
import { motion } from 'framer-motion'
import { GitPullRequest, ExternalLink, Clock } from 'lucide-react'
import { useMyPendingReviews } from '../../../hooks/useWorkBoard'
import { useWorkBoardFilters, applyFilters } from '../filters/filter-context-helpers'
import { useReviewAction } from '../../../hooks/useReviewAction'
import { InlineActions } from '../InlineActions'
import { SkeletonList, EmptyState, WebhookHint, UpsellCard } from '../shared/shared-ui'
import { ageLabel } from '../shared/formatters'

export function MyReviewsTab() {
    const { data, loading, error, refresh } = useMyPendingReviews()
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

    if (loading) return <SkeletonList count={5} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load reviews. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const filtered = applyFilters(data || [], params)
    const reviews = filtered.filter(r => !optimisticallyRemoved.has(`${r.repoFullName}#${r.prNumber}`))
    if (reviews.length === 0) {
        return (
            <>
                <EmptyState
                    icon={GitPullRequest}
                    title="No pending reviews"
                    subtitle="Great work! You have no open review requests right now."
                />
                <WebhookHint />
            </>
        )
    }

    return (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {reviews.map((r, i) => (
                <motion.a
                    key={`${r.repoFullName}-${r.prNumber}`}
                    href={`https://github.com/${r.repoFullName}/pull/${r.prNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                >
                    <div className="mt-0.5 p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex-shrink-0">
                        <GitPullRequest className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {r.title || `PR #${r.prNumber}`}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            <span className="font-mono text-indigo-600 dark:text-indigo-400">{r.repoFullName}</span>
                            {' '}#{r.prNumber}
                            {r.authorLogin && <> by <strong>{r.authorLogin}</strong></>}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                        <Clock className="w-3 h-3" />
                        {ageLabel(r.ageHours)}
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <InlineActions
                        onApprove={() => actions.approve({ repoFullName: r.repoFullName, prNumber: r.prNumber })}
                        onRequestChanges={() => {
                            const body = window.prompt('What needs changing?')
                            if (body && body.trim()) {
                                actions.requestChanges({ repoFullName: r.repoFullName, prNumber: r.prNumber, body })
                            }
                        }}
                        onSnooze={(hours) => actions.snooze({ repoFullName: r.repoFullName, prNumber: r.prNumber, hours })}
                    />
                </motion.a>
            ))}
        </div>
    )
}
