import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, RefreshCw, RotateCcw, CheckCircle2, AlertTriangle, WifiOff, HelpCircle } from 'lucide-react'
import { apiCall } from '../../utils/api'
import { useToast } from '../../hooks/useToast'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'

const STATE_META = {
    ok:           { Icon: CheckCircle2,  accent: 'text-emerald-500', dot: 'bg-emerald-500',  label: 'Healthy' },
    invalid:      { Icon: AlertTriangle, accent: 'text-red-500',     dot: 'bg-red-500',      label: 'Invalid key' },
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
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [resetting, setResetting] = useState(false)
    const { toast } = useToast()
    const lastOutcomeRel = useRelativeTime(stats?.lastOutcomeAt ?? null)

    const fetchStats = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await apiCall('/api/admin/ai/probe-stats')
            setStats(data)
        } catch (err) {
            setError(err)
            setStats(null)
        } finally {
            setLoading(false)
        }
    }, [])

    /* eslint-disable react-hooks/set-state-in-effect -- mount-time fetch + manual refresh */
    useEffect(() => {
        if (!isAdmin) {
            setLoading(false)
            return
        }
        fetchStats()
    }, [isAdmin, fetchStats])
    /* eslint-enable react-hooks/set-state-in-effect */

    const handleReset = useCallback(async () => {
        setResetting(true)
        try {
            await apiCall('/api/admin/ai/probe-stats/reset', { method: 'POST' })
            toast.success('Probe counters reset')
            await fetchStats()
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Reset failed' })
        } finally {
            setResetting(false)
        }
    }, [fetchStats, toast])

    if (!isAdmin) {
        return (
            <EmptyState
                icon={ShieldAlert}
                title="Admin only"
                description="The probe counters are restricted to admin accounts. Contact your operator for access."
                gradient="from-slate-400 to-slate-500"
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
                gradient="from-red-400 to-rose-500"
                action={{ label: 'Retry', onClick: fetchStats }}
            />
        )
    }

    const total = stats?.total ?? 0

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">
                        AI key probes
                    </p>
                    <h3 className="mt-0.5 text-base font-bold text-slate-900 dark:text-slate-100 ds-font-display">
                        {total > 0 ? `${total} probes since restart` : 'No probes yet this process'}
                    </h3>
                    {lastOutcomeRel && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Last outcome {lastOutcomeRel}
                        </p>
                    )}
                </div>
                <div className="shrink-0 flex gap-2">
                    <Button variant="secondary" size="sm" onClick={fetchStats} disabled={loading}>
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                    <Button variant="outline-danger" size="sm" onClick={handleReset} disabled={resetting || total === 0}>
                        <RotateCcw className={`w-3.5 h-3.5 ${resetting ? 'animate-spin' : ''}`} />
                        Reset
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {ORDER.map((stateKey) => {
                    const meta = STATE_META[stateKey]
                    const count = stats?.[stateKey] ?? 0
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0
                    return (
                        <Card key={stateKey} glass={false} shadow="sm" className="p-4">
                            <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${meta.dot}`} aria-hidden="true" />
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    {meta.label}
                                </span>
                            </div>
                            <div className="mt-2 flex items-end justify-between gap-2">
                                <span className={`text-2xl font-bold tabular-nums ds-font-display ${meta.accent}`}>
                                    {count}
                                </span>
                                <span className="text-[11px] text-slate-400 dark:text-slate-500 pb-1">
                                    {pct}%
                                </span>
                            </div>
                        </Card>
                    )
                })}
            </div>

            <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Counters live in process memory and reset on server restart by design — this is a short-window operational signal, not long-term metrics.
            </p>
        </div>
    )
}
