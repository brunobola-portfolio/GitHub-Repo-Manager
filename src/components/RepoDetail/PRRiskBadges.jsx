import { AlertTriangle, Clock, FileText, Sparkles, Users } from 'lucide-react'
import { computePRRisks } from '../../utils/prRisk'
import { toneToLevel, riskFillClass, riskTextClass, riskTintClass, riskRingClass } from '../../utils/riskTokens'

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
                const level = toneToLevel(risk.tone)
                if (compact) {
                    return (
                        <span
                            key={risk.id}
                            title={`${risk.label} — ${risk.hint}`}
                            className={`inline-block w-2 h-2 rounded-full ${riskFillClass(level)}`}
                            aria-label={`${risk.label}: ${risk.hint}`}
                        />
                    )
                }
                return (
                    <span
                        key={risk.id}
                        title={risk.hint}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ds-text-micro font-semibold uppercase tracking-wide ${riskTintClass(level)} ${riskTextClass(level)} ${riskRingClass(level)}`}
                    >
                        {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
                        {risk.label}
                    </span>
                )
            })}
        </div>
    )
}
