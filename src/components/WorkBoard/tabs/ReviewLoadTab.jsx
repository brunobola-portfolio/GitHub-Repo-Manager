import { motion } from 'framer-motion'
import { Users } from 'lucide-react'
import { useReviewLoad } from '../../../hooks/useWorkBoard'
import { SkeletonList, EmptyState, WebhookHint, UpsellCard, ErrorState } from '../shared/shared-ui'
import { Card } from '../../ui/Card'

export function ReviewLoadTab() {
    const { data, loading, error, refresh } = useReviewLoad()

    if (loading) return <SkeletonList count={5} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return <ErrorState error={error} what="review load" onRetry={refresh} />
    }

    const reviewers = Array.isArray(data) ? data : []
    if (reviewers.length === 0) {
        return (
            <>
                <EmptyState
                    icon={Users}
                    title="No review assignments yet"
                    subtitle="Once GitHub starts sending review_requested events, each reviewer's open + completed counts show up here."
                />
                <WebhookHint />
            </>
        )
    }

    const maxCombined = Math.max(
        ...reviewers.map(r => (r.reviewsSubmitted || 0) + (r.reviewsPending || 0)),
        1
    )

    return (
        <div className="p-4 space-y-3">
            <div className="ds-eyebrow flex items-center gap-3 text-slate-500 dark:text-slate-400">
                <Users className="w-3.5 h-3.5" />
                <span>Review load — last 30 days</span>
                <span className="ml-auto flex items-center gap-3 normal-case font-medium ds-text-micro">
                    <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-emerald-500" />
                        Submitted
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-amber-500" />
                        Pending
                    </span>
                </span>
            </div>
            <Card glass={false} shadow="none" className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {reviewers.map((r, i) => {
                    const submitted = r.reviewsSubmitted || 0
                    const pending = r.reviewsPending || 0
                    const total = submitted + pending
                    const submittedPct = total ? (submitted / maxCombined) * 100 : 0
                    const pendingPct = total ? (pending / maxCombined) * 100 : 0
                    return (
                        <motion.div
                            key={r.reviewerLogin}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(i * 0.03, 0.3) }}
                            className="flex items-center gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors bg-white/60 dark:bg-slate-900/40"
                        >
                            <div className="w-32 shrink-0 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                                {r.reviewerLogin}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div
                                    className="flex h-2.5 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800"
                                    role="img"
                                    aria-label={`${r.reviewerLogin}: ${submitted} submitted, ${pending} pending`}
                                >
                                    {submittedPct > 0 && (
                                        <div
                                            className="bg-emerald-500 dark:bg-emerald-500/90"
                                            style={{ width: `${submittedPct}%` }}
                                        />
                                    )}
                                    {pendingPct > 0 && (
                                        <div
                                            className="bg-amber-500 dark:bg-amber-500/90"
                                            style={{ width: `${pendingPct}%` }}
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums w-24 text-right">
                                <span className="text-emerald-700 dark:text-emerald-400">{submitted}</span>
                                <span className="text-slate-400 mx-1">·</span>
                                <span className="text-amber-700 dark:text-amber-400">{pending}</span>
                            </div>
                        </motion.div>
                    )
                })}
            </Card>
        </div>
    )
}
