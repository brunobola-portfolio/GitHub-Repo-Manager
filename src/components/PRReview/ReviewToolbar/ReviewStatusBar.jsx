import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ShieldCheck, ShieldAlert, MessageCircle } from 'lucide-react'

/**
 * Sticky bottom action bar showing review progress + (when wired)
 * Approve / Comment / Request changes thumb-zone buttons. Includes an
 * animated SVG progress ring whose stroke offset springs to its new
 * value when the user marks a file viewed (Framer Motion).
 *
 * @param {object} props
 * @param {number} props.totalFiles                - Total number of files in the PR
 * @param {number} props.reviewedCount             - Number of files the user has marked reviewed
 * @param {number} [props.pendingCommentCount=0]   - Number of pending (unsaved) comments
 * @param {(arg: { event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' }) => void} [props.onSubmitReview]
 *        - Optional. When provided, renders the three action buttons in
 *          the thumb zone. Caller decides what body / staleness check to
 *          run before posting.
 */
export function ReviewStatusBar({
    totalFiles,
    reviewedCount,
    pendingCommentCount = 0,
    onSubmitReview,
}) {
    const reducedMotion = useReducedMotion()

    const [showHints] = useState(() => {
        const count = parseInt(localStorage.getItem('pr-review-hint-sessions') || '0')
        return count < 3
    })

    useEffect(() => {
        const key = 'pr-review-hint-sessions'
        const count = parseInt(localStorage.getItem(key) || '0')
        localStorage.setItem(key, String(count + 1))
    }, [])

    const safeTotal = totalFiles > 0 ? totalFiles : 0
    const ratio = safeTotal > 0 ? reviewedCount / safeTotal : 0
    const allReviewed = safeTotal > 0 && reviewedCount >= safeTotal

    // SVG ring geometry. radius 14 → circumference ≈ 87.96
    const RADIUS = 14
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS
    const offset = CIRCUMFERENCE * (1 - ratio)

    return (
        <footer
            aria-live="polite"
            aria-label="Review progress"
            className="flex items-center gap-3 px-3 py-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 select-none flex-wrap"
            style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
            {/* Progress ring */}
            <svg
                width="32"
                height="32"
                viewBox="0 0 36 36"
                data-testid="review-progress-ring"
                role="progressbar"
                aria-valuenow={reviewedCount}
                aria-valuemin={0}
                aria-valuemax={safeTotal}
                aria-label={`${reviewedCount} of ${safeTotal} files reviewed`}
                className="shrink-0"
            >
                <circle
                    cx="18"
                    cy="18"
                    r={RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.22"
                    strokeWidth="3"
                />
                <motion.circle
                    cx="18"
                    cy="18"
                    r={RADIUS}
                    fill="none"
                    stroke={allReviewed ? 'rgb(34 197 94)' : 'rgb(99 102 241)'}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    initial={false}
                    animate={{ strokeDashoffset: offset }}
                    transition={
                        reducedMotion
                            ? { duration: 0 }
                            : { type: 'spring', stiffness: 220, damping: 22 }
                    }
                    transform="rotate(-90 18 18)"
                />
            </svg>

            <span className={`tabular-nums text-sm font-medium ${allReviewed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {reviewedCount}/{safeTotal} reviewed
            </span>

            {pendingCommentCount > 0 && (
                <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">
                    {pendingCommentCount} pending {pendingCommentCount === 1 ? 'comment' : 'comments'}
                </span>
            )}

            {/* Live region for screen readers — announces progress changes
                without re-narrating the entire footer (which would happen
                if the footer itself carried aria-live). See a11y review
                2026-05-09 (Onda 2.7). */}
            <span className="sr-only" aria-live="polite" aria-atomic="true">
                {reviewedCount} of {safeTotal} files reviewed
                {pendingCommentCount > 0 ? `, ${pendingCommentCount} pending` : ''}
            </span>

            <span className="flex-1" />

            {showHints && !onSubmitReview && (
                <span className="hidden sm:inline text-slate-400 dark:text-slate-500 tabular-nums">
                    j/k navigate &middot; x mark reviewed &middot; c comment
                </span>
            )}

            {onSubmitReview && (
                <div className="flex items-center gap-1.5 ml-auto max-md:w-full">
                    <button
                        type="button"
                        onClick={() => onSubmitReview({ event: 'APPROVE' })}
                        className="inline-flex items-center justify-center gap-1 px-3 py-1.5 max-md:min-h-11 max-md:flex-1 rounded-md text-xs font-semibold bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 hover:bg-emerald-700 motion-safe:active:scale-95 transition-all"
                        aria-label="Approve"
                    >
                        <ShieldCheck className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                        type="button"
                        onClick={() => onSubmitReview({ event: 'COMMENT' })}
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-1 max-md:min-h-11 max-md:flex-1 rounded-md text-xs font-medium bg-transparent border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        aria-label="Comment"
                    >
                        <MessageCircle className="w-3.5 h-3.5" /> Comment
                    </button>
                    <button
                        type="button"
                        onClick={() => onSubmitReview({ event: 'REQUEST_CHANGES' })}
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-1 max-md:min-h-11 max-md:flex-1 rounded-md text-xs font-medium bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                        aria-label="Request changes"
                    >
                        <ShieldAlert className="w-3.5 h-3.5" /> Request changes
                    </button>
                </div>
            )}
        </footer>
    )
}
