import { HeartPulse, Download, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useWorkBoardHealth } from '../../../hooks/useWorkBoard'
import { EmptyState, ErrorState, SkeletonList } from '../shared/shared-ui'
import { ManageReposButton } from '../ManageReposButton'
import { Badge } from '../../ui/Badge'
import { Card } from '../../ui/Card'
import { riskTextClass } from '../../../utils/riskTokens'
import { MOCK_MODE } from '../../../config'
import { formatDateTime } from '../../../utils/format'
import { todayISO } from '../../../utils/dates'

// Delta -> risk-token color: an improving score reads as "low risk" (good),
// a worsening one as "high risk" — reusing the same ds-risk-* text tokens
// every other risk-colored surface in the app uses (AGENTS.md: text always
// uses the *-text variant, never the raw fill, for AA contrast).
function deltaRiskLevel(delta) {
    if (delta == null || delta === 0) return 'neutral'
    return delta > 0 ? 'low' : 'high'
}

function DeltaChip({ delta }) {
    if (delta == null) {
        return <span className="ds-text-micro text-slate-500 dark:text-slate-400">—</span>
    }
    const level = deltaRiskLevel(delta)
    const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${riskTextClass(level)}`}>
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {delta > 0 ? '+' : ''}{delta}
        </span>
    )
}

function ScoreCell({ score }) {
    if (score == null) {
        return <span className="ds-text-micro text-slate-500 dark:text-slate-400">Not yet scored</span>
    }
    const level = score >= 80 ? 'low' : score >= 60 ? 'medium' : score >= 40 ? 'high' : 'critical'
    return (
        <span className={`text-sm font-bold tabular-nums ${riskTextClass(level)}`}>{score}</span>
    )
}

function exportHealthCsv(repos) {
    const rows = [
        ['repo', 'score', 'delta', 'failing_checks', 'last_checked_at'],
        ...repos.map(r => [
            r.repoFullName,
            r.score ?? '',
            r.delta ?? '',
            (r.failingChecks || []).join('; '),
            r.lastCheckedAt || '',
        ]),
    ]
    const csv = rows.map(row => row.map(v => {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `portfolio-health-${todayISO()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

export function HealthTab() {
    const { data, loading, error, refresh } = useWorkBoardHealth()

    if (loading) return <SkeletonList count={5} />
    if (error) return <ErrorState error={error} what="portfolio health" onRetry={refresh} />

    const repos = data?.repos || []

    if (repos.length === 0) {
        return (
            <div className="space-y-4">
                <EmptyState
                    icon={HeartPulse}
                    title="No repositories tracked yet"
                    subtitle="Track a repository to start scoring it for documentation, standards and activity — the same 0–100 check available per-repo, now ranked across your whole portfolio."
                />
                <div className="flex justify-center">
                    <ManageReposButton />
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
                <p className="ds-text-meta text-slate-500 dark:text-slate-400">
                    {repos.length} tracked {repos.length === 1 ? 'repository' : 'repositories'} · ranked by health score
                </p>
                <button
                    type="button"
                    onClick={() => exportHealthCsv(repos)}
                    aria-label="Export portfolio health as CSV"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg
                        text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30
                        hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors ds-focus-ring"
                >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                </button>
            </div>

            <Card glass={false} shadow="none" className="overflow-hidden bg-slate-50 dark:bg-slate-800/50">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200/60 dark:border-slate-700/60 text-left">
                                <th className="px-4 py-2.5 ds-eyebrow text-slate-500 dark:text-slate-400">Repository</th>
                                <th className="px-4 py-2.5 ds-eyebrow text-slate-500 dark:text-slate-400">Score</th>
                                <th className="px-4 py-2.5 ds-eyebrow text-slate-500 dark:text-slate-400">7-day change</th>
                                <th className="px-4 py-2.5 ds-eyebrow text-slate-500 dark:text-slate-400">Failing checks</th>
                                <th className="px-4 py-2.5 ds-eyebrow text-slate-500 dark:text-slate-400">Last checked</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {repos.map((r) => (
                                <tr key={r.repoFullName} className="hover:bg-white/60 dark:hover:bg-slate-800/80 transition-colors">
                                    <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200 truncate max-w-[220px]">
                                        {r.repoFullName}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <ScoreCell score={r.score} />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <DeltaChip delta={r.delta} />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        {r.failingChecks && r.failingChecks.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {r.failingChecks.slice(0, 3).map((check) => (
                                                    <Badge key={check} tone="warning" size="xs">{check}</Badge>
                                                ))}
                                                {r.failingChecks.length > 3 && (
                                                    <Badge tone="neutral" size="xs">+{r.failingChecks.length - 3} more</Badge>
                                                )}
                                            </div>
                                        ) : r.score != null ? (
                                            <Badge tone="success" size="xs">All checks passing</Badge>
                                        ) : (
                                            <span className="ds-text-micro text-slate-500 dark:text-slate-400">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5 ds-text-micro text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                        {r.lastCheckedAt ? formatDateTime(r.lastCheckedAt) : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
            {MOCK_MODE && (
                <p className="ds-text-micro text-slate-500 dark:text-slate-400 text-center">
                    Demo data — connect a real account to score your own repositories.
                </p>
            )}
        </div>
    )
}
