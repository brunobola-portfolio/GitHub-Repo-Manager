import { Heart } from 'lucide-react'

/**
 * Visual scale: 80+ green, 60-79 amber, <60 rose. The thresholds match the
 * legend used by the AI insights modal so the at-a-glance badge agrees with
 * the deeper view a click away.
 */
const TONES = {
    high:   { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/30 ring-emerald-200/70 dark:ring-emerald-800/50' },
    medium: { dot: 'bg-amber-500',   text: 'text-amber-700 dark:text-amber-300',     bg: 'bg-amber-50 dark:bg-amber-900/30 ring-amber-200/70 dark:ring-amber-800/50' },
    low:    { dot: 'bg-rose-500',    text: 'text-rose-700 dark:text-rose-300',       bg: 'bg-rose-50 dark:bg-rose-900/30 ring-rose-200/70 dark:ring-rose-800/50' },
}

function pickTone(score) {
    if (score == null || Number.isNaN(score)) return null
    if (score >= 80) return TONES.high
    if (score >= 60) return TONES.medium
    return TONES.low
}

/**
 * Compact AI health badge for repo lists. Renders nothing when the repo
 * hasn't been indexed yet (score is null) so unindexed rows stay clean.
 *
 * Hover surfaces a tooltip with the exact score. When `onClick` is provided
 * the badge becomes an interactive button (focus ring + cursor pointer)
 * that opens the deeper insights view; without it it stays a non-interactive
 * `<span>` for callers that just want to display the score.
 */
export function RepoHealthBadge({ score, className = '', onClick }) {
    const tone = pickTone(score)
    if (!tone) return null
    const baseClasses = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ds-text-micro font-semibold ring-1 ring-inset ${tone.bg} ${tone.text} ${className}`.trim()
    const content = (
        <>
            <Heart className="w-2.5 h-2.5" aria-hidden="true" />
            {Math.round(score)}
        </>
    )
    if (onClick) {
        return (
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClick() }}
                className={`${baseClasses} cursor-pointer hover:brightness-110 ds-focus-ring`}
                title={`AI health score: ${score}/100 — click to see details`}
                aria-label={`AI health score ${score} out of 100`}
            >
                {content}
            </button>
        )
    }
    return (
        <span
            className={baseClasses}
            title={`AI health score: ${score}/100`}
            aria-label={`AI health score ${score} out of 100`}
        >
            {content}
        </span>
    )
}
