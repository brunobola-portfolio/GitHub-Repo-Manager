import { AlertTriangle, Clock, FileText, Sparkles, Users } from 'lucide-react'
import { computePRRisks } from '../../utils/prRisk'

const TONE_CLASS = {
    danger: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-200 dark:ring-red-800',
    warning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800',
    info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-200 dark:ring-sky-800',
    neutral: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
}

const ICON = {
    'very-stale': Clock,
    stale: Clock,
    'no-description': FileText,
    'short-description': FileText,
    breaking: AlertTriangle,
    unassigned: Users,
    'reviewer-bystander': Users,
    draft: Sparkles,
}

/**
 * PRRiskBadges — inline row of risk pills for a PR list item.
 *
 * Heuristics live in `src/utils/prRisk.js` so the same signals can feed the
 * future Attention Feed and the PR-detail panel summary. The visual
 * contract here is intentionally compact (single-line, no wrapping
 * overflow) so it doesn't push the row layout around.
 *
 * Pass `compact` to hide the label and show only a tinted dot when space
 * is tight (e.g. inside a row that already has a long PR title).
 */
export function PRRiskBadges({ pr, compact = false, max = 4, className = '' }) {
    const risks = computePRRisks(pr).slice(0, max)
    if (!risks.length) return null

    return (
        <div className={`inline-flex flex-wrap items-center gap-1 ${className}`.trim()}>
            {risks.map((risk) => {
                const Icon = ICON[risk.id]
                const toneClass = TONE_CLASS[risk.tone] ?? TONE_CLASS.neutral
                if (compact) {
                    return (
                        <span
                            key={risk.id}
                            title={`${risk.label} — ${risk.hint}`}
                            className={`inline-block w-2 h-2 rounded-full ring-2 ring-inset ${toneClass}`}
                            aria-label={`${risk.label}: ${risk.hint}`}
                        />
                    )
                }
                return (
                    <span
                        key={risk.id}
                        title={risk.hint}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${toneClass}`}
                    >
                        {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
                        {risk.label}
                    </span>
                )
            })}
        </div>
    )
}
