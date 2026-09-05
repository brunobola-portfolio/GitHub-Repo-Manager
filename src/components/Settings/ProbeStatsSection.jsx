import { useCallback, useState } from 'react'
import { ShieldAlert, RefreshCw, RotateCcw, CheckCircle2, AlertTriangle, WifiOff, HelpCircle } from 'lucide-react'
import { apiCall } from '../../utils/api'
import { useToast } from '../../hooks/useToast'
import { useTabData } from '../../hooks/useTabData.js'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'
import { PanelHeader } from '../ui/PanelHeader'

const STATE_META = {
    ok:           { Icon: CheckCircle2,  accent: 'text-emerald-500', dot: 'bg-emerald-500',  label: 'Healthy' },
    invalid:      { Icon: AlertTriangle, accent: 'text-rose-600 dark:text-rose-400',     dot: 'bg-rose-500',      label: 'Invalid key' },
    unreachable:  { Icon: WifiOff,       accent: 'text-amber-500',   dot: 'bg-amber-500',    label: 'Unreachable' },
    unknown:      { Icon: HelpCircle,    accent: 'text-slate-500',   dot: 'bg-slate-400',    label: 'Unknown' },
}

const ORDER = ['ok', 'invalid', 'unreachable', 'unknown']

/**
 * Admin-only Settings section that exposes the AI key health probe counters.
 * Backed by /api/admin/ai/probe-stats; resilient to 403 (renders an
 * EmptyState explaining the gate) and to network failures (shows error
 * banner + retry).
 *
 * Counters reset on process restart by design — this section is short-window
 * operational visibility, not long-term metrics.
 */
export function ProbeStatsSection({ isAdmin = false }) {
    const [resetting, setResetting] = useState(false)
    const { toast } = useToast()

    // Single shared loader with AbortController cancellation via useTabData —
    // replaces the hand-rolled loading/error/try-catch + mount effect (and its
    // eslint-disable). Non-admins skip the fetch entirely; the render
    // short-circuits to the "admin only" state below regardless.
    const { data: stats, loading, error, reload } = useTabData(
        () => (isAdmin ? apiCall('/api/admin/ai/probe-stats') : Promise.resolve(null)),
        [isAdmin],
    )
    const lastOutcomeRel = useRelativeTime(stats?.lastOutcomeAt ?? null)

    const handleReset = useCallback(async () => {
        setResetting(true)
        try {
            await apiCall('/api/admin/ai/probe-stats/reset', { method: 'POST' })
            toast.success('Probe counters reset')
            await reload()
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Reset failed' })
        } finally {
            setResetting(false)
        }
    }, [reload, toast])

    if (!isAdmin) {
        return (
            <EmptyState
                icon={ShieldAlert}
                title="Admin only"
                description="The probe counters are restricted to admin accounts. Contact your operator for access."
            />
        )
    }

    if (loading) {
        return (
            <div className="space-y-3">
                <Skeleton variant="card" className="h-16" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {ORDER.map((k) => <Skeleton key={k} variant="card" className="h-24" />)}
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <EmptyState
                icon={AlertTriangle}
                title="Couldn't load probe stats"
                description={error.message ?? 'Unknown error talking to /api/admin/ai/probe-stats.'}
                action={{ label: 'Retry', onClick: reload }}
            />
        )
    }

    const total = stats?.total ?? 0

    return (
        <div className="space-y-5">
            <PanelHeader
                eyebrow="AI key probes"
                title={total > 0 ? `${total} probes since restart` : 'No probes yet this process'}
                description={lastOutcomeRel ? `Last outcome ${lastOutcomeRel}` : undefined}
                actions={
                    <>
                        <Button variant="secondary" size="sm" onClick={reload} disabled={loading}>
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                        <Button variant="outline-danger" size="sm" onClick={handleReset} disabled={resetting || total === 0}>
                            <RotateCcw className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} />
                            Reset
                        </Button>
                    </>
                }
            />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {ORDER.map((stateKey) => {
                    const meta = STATE_META[stateKey]
                    const count = stats?.[stateKey] ?? 0
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0
                    return (
                        <Card key={stateKey} glass={false} shadow="sm" className="p-4">
                            <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${meta.dot}`} aria-hidden="true" />
                                <span className="ds-text-meta font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    {meta.label}
                                </span>
                            </div>
                            <div className="mt-2 flex items-end justify-between gap-2">
                                <span className={`text-2xl font-bold tabular-nums ds-font-display ${meta.accent}`}>
                                    {count}
                                </span>
                                <span className="ds-text-meta text-slate-500 dark:text-slate-400 pb-1">
                                    {pct}%
                                </span>
                            </div>
                        </Card>
                    )
                })}
            </div>

            <p className="ds-text-meta text-slate-500 dark:text-slate-400">
                Counters live in process memory and reset on server restart by design — this is a short-window operational signal, not long-term metrics.
            </p>
        </div>
    )
}
