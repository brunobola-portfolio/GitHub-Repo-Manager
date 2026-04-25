import { Rocket, Download } from 'lucide-react'
import { useDORASummary } from '../../../hooks/useWorkBoard'
import { EmptyState, WebhookHint, UpsellCard } from '../shared/shared-ui'
import { hoursLabel } from '../shared/formatters'
import { MOCK_MODE, API_BASE_URL } from '../../../config'
import { Card } from '../../ui/Card'

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
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-indigo-500"
            />
        </svg>
    )
}

function KPI({ label, value, sub }) {
    return (
        <Card glass={false} shadow="none" className="flex-1 p-4 text-center bg-slate-50 dark:bg-slate-800/50">
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value ?? '—'}</div>
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-0.5">{label}</div>
            {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
        </Card>
    )
}

export function DORATab() {
    const { data, loading, error, refresh } = useDORASummary({ environment: 'production' })

    if (loading) {
        return (
            <div className="p-6 space-y-4 animate-pulse">
                <div className="flex gap-3">
                    {[1, 2, 3, 4].map(i => <div key={i} className="flex-1 h-20 rounded-2xl bg-slate-200 dark:bg-slate-700" />)}
                </div>
                <div className="h-14 rounded-xl bg-slate-200 dark:bg-slate-700" />
            </div>
        )
    }

    if (error) {
        if (error.status === 403) return <UpsellCard tier="enterprise" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load DORA metrics. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const summary = data || {}
    const deploy = summary.deployFrequency || { totalDeployments: 0, perDay: [] }
    const lead = summary.leadTime || { p50: null, p90: null, sampleSize: 0 }
    const cfr = summary.changeFailureRate || { rate: null, failed: 0, total: 0 }
    const mttr = summary.mttr || { p50: null, p90: null, sampleSize: 0, unresolved: 0 }

    const totalDeployments = deploy.totalDeployments ?? 0
    const perDay = deploy.perDay || []
    const cfrDisplay = cfr.rate != null ? `${(cfr.rate * 100).toFixed(1)}%` : '—'
    const cfrSub = cfr.total > 0 ? `${cfr.failed}/${cfr.total} failed` : 'no data'

    const exportCsv = () => {
        if (MOCK_MODE) {
            // In mock mode just synthesize + download client-side so the flow is visible.
            const rows = [
                ['metric', 'value'],
                ['environment', 'production'],
                ['total_deployments_30d', totalDeployments],
                ['lead_time_p50_hours', lead.p50 ?? ''],
                ['lead_time_p90_hours', lead.p90 ?? ''],
                ['change_failure_rate', cfr.rate ?? ''],
                ['mttr_p50_hours', mttr.p50 ?? ''],
                ['mttr_p90_hours', mttr.p90 ?? ''],
            ]
            const csv = rows.map(r => r.join(',')).join('\n')
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `dora-production-${new Date().toISOString().slice(0, 10)}.csv`
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
            return
        }
        const url = `${API_BASE_URL}/api/v1/work-board/dora.csv?environment=production`
        window.open(url, '_blank', 'noopener')
    }

    return (
        <div className="p-6 space-y-5">
            {/* Header with export */}
            <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    production · last 30 days
                </div>
                <button
                    onClick={exportCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                    aria-label="Export DORA metrics as CSV"
                >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                </button>
            </div>

            {/* KPIs — 4 cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KPI
                    label="Deployments"
                    value={totalDeployments}
                    sub={`avg ${perDay.length > 0 ? (totalDeployments / perDay.length).toFixed(1) : '—'}/day`}
                />
                <KPI
                    label="Lead time p50 / p90"
                    value={lead.p50 != null ? `${hoursLabel(lead.p50)} / ${hoursLabel(lead.p90)}` : '—'}
                    sub={lead.sampleSize > 0 ? `${lead.sampleSize} PRs merged` : 'no merged PRs'}
                />
                <KPI
                    label="Change failure rate"
                    value={cfrDisplay}
                    sub={cfrSub}
                />
                <KPI
                    label="MTTR p50 / p90"
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
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
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
