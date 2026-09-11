import { useState } from 'react'
import { Rocket, Download, Info } from 'lucide-react'
import { useDORASummary } from '../../../hooks/useWorkBoard'
import { EmptyState, WebhookHint, ErrorState } from '../shared/shared-ui'
import { hoursLabel } from '../shared/formatters'
import { MOCK_MODE, API_BASE_URL } from '../../../config'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select } from '../../ui/Select'
import { Tooltip } from '../../ui/Tooltip'
import { Skeleton } from '../../ui/Skeleton'
import { todayISO } from '../../../utils/dates'

// What each figure is, in DORA's own words (dora.dev), and how it is measured
// from GitHub here. Shown on hover/focus of every KPI so the tab never uses
// the acronym without saying what it stands for.
const DEFINITIONS = {
    deployments: 'Deployment frequency — how often changes reach production. Counted from successful GitHub deployment statuses for the chosen environment.',
    leadDeployed: 'Change lead time — how long a change takes to go from version control to running in production. Measured from the pull request being opened to the first successful deployment of that repository after the merge.',
    leadMerged: 'Change lead time needs deployments to measure. None followed a merge in this window, so this shows pull request opened → merged instead (PR cycle time).',
    cfr: 'Change fail rate — the share of deployments that fail and need immediate intervention. Counted from deployments whose final status is failure or error.',
    recovery: 'Failed deployment recovery time (formerly MTTR) — how long it takes to recover from a failed deployment. Measured from the failed status to the next successful deployment of the same repository and environment.',
}

function SparkLine({ perDay }) {
    if (!perDay || perDay.length === 0) return null
    const max = Math.max(...perDay.map(d => d.count), 1)
    const W = 400
    const H = 60
    const step = W / (perDay.length - 1 || 1)

    const points = perDay
        .map((d, i) => `${i * step},${H - (d.count / max) * (H - 4)}`)
        .join(' ')

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none" aria-hidden="true">
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-brand-500"
            />
        </svg>
    )
}

function KPI({ label, value, sub, definition }) {
    return (
        <Card glass={false} shadow="none" className="flex-1 p-4 text-center bg-slate-50 dark:bg-slate-800/50">
            <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100 ds-font-display">{value ?? '—'}</div>
            <div className="mt-0.5 flex items-center justify-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span>{label}</span>
                <Tooltip label={definition}>
                    <button type="button" className="rounded p-0.5 text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:text-slate-200" aria-label={`What is ${label}?`}>
                        <Info className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                </Tooltip>
            </div>
            {sub && <div className="ds-text-micro text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
        </Card>
    )
}

export function DORATab() {
    const [environment, setEnvironment] = useState('production')
    const { data, loading, error, refresh } = useDORASummary({ environment })

    if (loading) {
        return (
            <div className="p-6 space-y-4">
                <div className="flex gap-3">
                    {[1, 2, 3, 4].map(i => <Skeleton key={i} variant="card" className="flex-1 h-20 rounded-2xl" />)}
                </div>
                <Skeleton className="h-14 rounded-xl" />
            </div>
        )
    }

    // DORA metrics moved off the Enterprise paywall to Free (2026-07-18
    // rebalance) — the backend no longer 403s for tier, so any error here is
    // a genuine failure, not an upsell signal.
    if (error) {
        return <ErrorState error={error} what="DORA metrics" onRetry={refresh} />
    }

    const summary = data || {}
    const deploy = summary.deployFrequency || { totalDeployments: 0, perDay: [] }
    const lead = summary.leadTime || { p50: null, p90: null, sampleSize: 0 }
    const cfr = summary.changeFailureRate || { rate: null, failed: 0, total: 0 }
    const mttr = summary.mttr || { p50: null, p90: null, sampleSize: 0, unresolved: 0 }
    // Environments that actually deployed in the window; the current one is
    // always offered so the picker never loses the selection.
    const environments = Array.from(new Set([environment, ...(summary.environments || []).map(e => e.name)]))

    const totalDeployments = deploy.totalDeployments ?? 0
    const perDay = deploy.perDay || []
    const cfrDisplay = cfr.rate != null ? `${(cfr.rate * 100).toFixed(1)}%` : '—'
    const cfrSub = cfr.total > 0 ? `${cfr.failed}/${cfr.total} failed` : 'no data'
    const leadIsPrCycle = lead.basis === 'merged'
    const leadSub = lead.sampleSize > 0
        ? (leadIsPrCycle ? `PR opened → merged · ${lead.sampleSize} PRs` : `PR opened → deployed · ${lead.sampleSize} PRs`)
        : 'no merged PRs'

    const exportCsv = () => {
        if (MOCK_MODE) {
            // In mock mode just synthesize + download client-side so the flow is visible.
            const rows = [
                ['metric', 'value'],
                ['environment', environment],
                ['total_deployments_30d', totalDeployments],
                ['lead_time_p50_hours', lead.p50 ?? ''],
                ['lead_time_p90_hours', lead.p90 ?? ''],
                ['change_failure_rate', cfr.rate ?? ''],
                ['failed_deployment_recovery_p50_hours', mttr.p50 ?? ''],
                ['failed_deployment_recovery_p90_hours', mttr.p90 ?? ''],
            ]
            const csv = rows.map(r => r.join(',')).join('\n')
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `dora-${environment}-${todayISO()}.csv`
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
            return
        }
        const url = `${API_BASE_URL}/api/v1/work-board/dora.csv?environment=${encodeURIComponent(environment)}`
        window.open(url, '_blank', 'noopener')
    }

    return (
        <div className="p-6 space-y-5">
            {/* What the tab is, before any number */}
            <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-slate-100">DORA</span> (DevOps Research and Assessment, Google Cloud&apos;s
                research programme) defines the metrics that predict software delivery performance: how often you ship, how long a change
                takes to reach production, how often a deployment fails and how fast you recover. Computed here from GitHub pull requests and
                deployment statuses.
            </p>

            {/* Environment + export */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <span>Environment</span>
                    <Select
                        size="sm"
                        label="Deployment environment"
                        value={environment}
                        onChange={setEnvironment}
                        className="min-w-[140px]"
                        options={environments.map(name => ({ value: name, label: name }))}
                    />
                    <span>· last 30 days</span>
                </div>
                <Button
                    variant="soft-primary"
                    size="sm"
                    onClick={exportCsv}
                    aria-label="Export DORA metrics as CSV"
                >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                </Button>
            </div>

            {/* KPIs — 4 cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KPI
                    label="Deployments"
                    definition={DEFINITIONS.deployments}
                    value={totalDeployments}
                    sub={`avg ${perDay.length > 0 ? (totalDeployments / perDay.length).toFixed(1) : '—'}/day`}
                />
                <KPI
                    label={leadIsPrCycle ? 'PR cycle time p50 / p90' : 'Change lead time p50 / p90'}
                    definition={leadIsPrCycle ? DEFINITIONS.leadMerged : DEFINITIONS.leadDeployed}
                    value={lead.p50 != null ? `${hoursLabel(lead.p50)} / ${hoursLabel(lead.p90)}` : '—'}
                    sub={leadSub}
                />
                <KPI
                    label="Change fail rate"
                    definition={DEFINITIONS.cfr}
                    value={cfrDisplay}
                    sub={cfrSub}
                />
                <KPI
                    label="Recovery time p50 / p90"
                    definition={DEFINITIONS.recovery}
                    value={mttr.p50 != null ? `${hoursLabel(mttr.p50)} / ${hoursLabel(mttr.p90)}` : '—'}
                    sub={
                        mttr.sampleSize > 0
                            ? `${mttr.sampleSize} failures recovered${mttr.unresolved > 0 ? `, ${mttr.unresolved} open` : ''}`
                            : mttr.unresolved > 0
                                ? `${mttr.unresolved} failure${mttr.unresolved === 1 ? '' : 's'} unresolved`
                                : 'no failures'
                    }
                />
            </div>

            {/* Sparkline */}
            {perDay.length > 0 ? (
                <Card glass={false} shadow="none" className="p-4 bg-slate-50 dark:bg-slate-800/50">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                        Daily successful deploys (last 30 days)
                    </div>
                    <SparkLine perDay={perDay} />
                    <div className="flex justify-between ds-text-micro text-slate-500 dark:text-slate-400 mt-1">
                        <span>{perDay[0]?.date}</span>
                        <span>{perDay[perDay.length - 1]?.date}</span>
                    </div>
                </Card>
            ) : (
                <>
                    <EmptyState
                        icon={Rocket}
                        title="No deployment data yet"
                        subtitle="Deploy events will appear here once your webhook delivers deployment_status events."
                    />
                    <WebhookHint />
                </>
            )}
        </div>
    )
}
