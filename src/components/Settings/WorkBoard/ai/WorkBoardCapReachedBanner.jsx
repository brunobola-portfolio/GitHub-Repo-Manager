import { motion, useReducedMotion } from 'framer-motion'
import { Wallet, ArrowRight, AlertTriangle } from 'lucide-react'
import { BANNER_VARIANTS, BANNER_REDUCED_VARIANTS } from '../../../AI/bannerMotion'

function formatCents(cents) {
    if (cents == null) return null
    const dollars = cents / 100
    return `$${dollars.toFixed(2)}`
}

/**
 * WorkBoardCapReachedBanner — shown when the Work Board AI monthly cap has
 * been reached. Tonally rose-amber to communicate "blocked but recoverable":
 * the user just needs to raise the cap in Settings or wait for the new month.
 */
export function WorkBoardCapReachedBanner({ spentCents, capCents, className = '' }) {
    const reduced = useReducedMotion()
    const variants = reduced ? BANNER_REDUCED_VARIANTS : BANNER_VARIANTS

    return (
        <motion.div
            initial="hidden"
            animate="visible"
            variants={variants}
            role="alert"
            aria-live="polite"
            className={`relative overflow-hidden rounded-xl p-4 ring-1 ring-inset ring-rose-500/30 bg-rose-500/[0.08] dark:bg-rose-500/[0.12] ${className}`}
        >
            <div className="flex items-start gap-3">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-rose-500/25 dark:bg-rose-500/35 ring-1 ring-inset ring-rose-500/40 flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-rose-600 dark:text-rose-300" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">AI monthly cap reached</h4>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-200 ring-1 ring-inset ring-rose-200 dark:ring-rose-800">
                            <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" /> Blocked
                        </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        Work Board AI is paused for the rest of this month. Raise the cap below or wait for the next billing window.
                    </p>
                    {(spentCents != null && capCents != null) && (() => {
                        const pct = capCents > 0
                            ? Math.min(100, Math.max(0, (spentCents / capCents) * 100))
                            : 100
                        return (
                            <div className="mt-3">
                                <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                                    <span>Spent this month</span>
                                    <span className="text-slate-700 dark:text-slate-200">
                                        {formatCents(spentCents)} <span className="text-slate-400">/ {formatCents(capCents)}</span>
                                    </span>
                                </div>
                                <div
                                    className="h-1.5 rounded-full bg-rose-100 dark:bg-rose-900/40 overflow-hidden"
                                    role="progressbar"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={Math.round(pct)}
                                    aria-label={`${Math.round(pct)}% of monthly AI cap used`}
                                >
                                    <div
                                        className="h-full bg-rose-500"
                                        style={{ width: `${pct}%` }}
                                        aria-hidden="true"
                                    />
                                </div>
                            </div>
                        )
                    })()}
                    <div className="mt-3 flex items-center gap-2">
                        <a
                            href="#ai-cap"
                            onClick={(e) => {
                                e.preventDefault()
                                document.getElementById('ai-cap-input')?.focus()
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 ring-1 ring-inset ring-rose-200 dark:ring-rose-800 rounded-lg transition-colors"
                        >
                            Adjust cap
                            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                        </a>
                    </div>
                </div>
            </div>
        </motion.div>
    )
}
