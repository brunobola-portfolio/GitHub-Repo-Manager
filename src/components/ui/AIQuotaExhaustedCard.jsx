import { motion } from 'framer-motion'
import { Gauge, ArrowRight, Sparkles, ExternalLink } from 'lucide-react'
import { navigateToPricing, openAppSettings } from '../../utils/appEvents'
import { formatTimeUntil } from '../../utils/format'

const TIER_LABEL = { pro: 'Pro', enterprise: 'Enterprise', free: 'Free' }

function formatResetAbsolute(iso) {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Premium replacement for the inline amber "quota reached" banner used in
 * AttentionFeed and InboxPanel. Mirrors the gradient + motion language of
 * QuotaExceededState (the full-page version), scoped down to fit inline
 * inside a dashboard card.
 */
export function AIQuotaExhaustedCard({
    feature: _feature = 'ai_queries',
    used,
    limit,
    resetAt = null,
    upgradeTo = null,
    currentTier = 'free',
}) {
    const upgradeLabel = upgradeTo && TIER_LABEL[upgradeTo]
    const resetRel = formatTimeUntil(resetAt)
    const resetAbs = formatResetAbsolute(resetAt)
    const tierLabel = TIER_LABEL[currentTier] || currentTier

    return (
        <motion.div
            data-testid="ai-quota-exhausted"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mx-5 my-3 rounded-2xl border border-rose-200 dark:border-rose-900/50"
        >
            <div className="rounded-2xl bg-white dark:bg-slate-900 p-4 sm:p-5">
                <div className="flex items-start gap-3 sm:gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-xl bg-rose-500 flex items-center justify-center shadow-sm">
                        <Gauge className="w-5 h-5 text-white" strokeWidth={2.5} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">AI insights paused</p>
                        {typeof used === 'number' && typeof limit === 'number' && (
                            <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-300 tabular-nums">
                                <span className="font-semibold">{used} / {limit}</span> requests used this month
                                {tierLabel ? <> on <span className="font-semibold">{tierLabel}</span></> : null}
                            </p>
                        )}
                        {(resetRel || resetAbs) && (
                            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {resetRel && <>Resets {resetRel}</>}
                                {resetRel && resetAbs && <> · </>}
                                {resetAbs}
                            </p>
                        )}
                        <p className="mt-2 text-[12px] text-slate-600 dark:text-slate-400">
                            The signals below are still live — only the AI narrative is muted.
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            {upgradeLabel && (
                                <button
                                    type="button"
                                    onClick={() => navigateToPricing(upgradeTo)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-[12px] text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                                >
                                    Upgrade to {upgradeLabel}
                                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => openAppSettings('usage')}
                                className="inline-flex items-center gap-1 text-[12px] text-indigo-600 dark:text-indigo-300 hover:underline"
                            >
                                <Sparkles className="w-3 h-3" aria-hidden="true" />
                                Manage usage
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </button>
                        </div>

                        {upgradeTo === 'pro' && (
                            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                                <li>· 5,000 queries / month</li>
                                <li>· Unlimited semantic search</li>
                                <li>· Unlimited repo insights</li>
                                <li>· Full migration toolset</li>
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    )
}
