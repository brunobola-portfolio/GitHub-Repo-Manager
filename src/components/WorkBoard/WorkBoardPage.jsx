/**
 * Cross-Repo Work Board — Phase E3
 *
 * Tabs:
 *   1. My Reviews   — pending review assignments (Free+)
 *   2. Stale PRs    — PRs open > N days (Pro+)
 *   3. My Issues    — assigned open issues (Free+)
 *   4. DORA         — deploy freq + lead time (Enterprise+)
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    GitPullRequest, CircleDot, Rocket, BarChart3,
    ExternalLink, Clock, AlertTriangle, Lock,
    Download, Wrench, Flame, Users, RefreshCw,
} from 'lucide-react'
import {
    useMyPendingReviews,
    useStalePRs,
    useMyOpenIssues,
    useDORASummary,
    useTechDebt,
    useReviewLoad,
} from '../../hooks/useWorkBoard'
import { useRelativeTime } from '../../hooks/useRelativeTime'
import { useUrlParams } from '../../hooks/useUrlParams'
import { WorkBoardFilterBar } from './filters/WorkBoardFilterBar'
import { PresetDropdown } from './filters/PresetDropdown'
import { FilterProvider, useWorkBoardFilters, applyFilters } from './filters/filter-context'
import { InlineActions } from './InlineActions'
import { useReviewAction } from '../../hooks/useReviewAction'
import { useContextShortcut } from '../../hooks/useKeyboardShortcuts'
import { useModal } from '../../hooks/useModal'
import { KeyboardHelpModal } from './KeyboardHelpModal'
import { AISummaryCard } from './AISummaryCard'
import { MOCK_MODE, API_BASE_URL } from '../../config'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ageLabel(hours) {
    if (hours == null) return '—'
    if (hours < 1) return 'just now'
    if (hours < 24) return `${Math.round(hours)}h old`
    return `${Math.round(hours / 24)}d old`
}

function dayLabel(days) {
    if (days == null) return '—'
    if (days < 1) return 'today'
    return `${Math.round(days)}d old`
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonRow() {
    return (
        <div className="flex items-start gap-3 p-4 animate-pulse">
            <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
            <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />
            </div>
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-16" />
        </div>
    )
}

function SkeletonList({ count = 5 }) {
    return (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {Array.from({ length: count }, (_, i) => <SkeletonRow key={i} />)}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ icon: Icon, title, subtitle }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-slate-400">
            <div className="relative w-20 h-20 mb-5">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-500/15 via-purple-500/10 to-transparent blur-lg" />
                <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 border border-slate-200/60 dark:border-slate-700/50 flex items-center justify-center shadow-sm">
                    <Icon className="w-9 h-9 text-indigo-400/70 dark:text-indigo-300/50" />
                </div>
            </div>
            <p className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-1.5">{title}</p>
            {subtitle && <p className="text-xs text-center max-w-sm leading-relaxed">{subtitle}</p>}
        </div>
    )
}

// ---------------------------------------------------------------------------
// No-data hint (webhook not yet configured)
// ---------------------------------------------------------------------------

function WebhookHint() {
    return (
        <div className="mt-3 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/50 text-sm text-indigo-700 dark:text-indigo-300">
            <strong>No data yet.</strong> Connect a GitHub webhook at{' '}
            <code className="text-xs bg-indigo-100 dark:bg-indigo-900/50 px-1 py-0.5 rounded">
                /api/v1/webhooks/github
            </code>{' '}
            with a <code className="text-xs bg-indigo-100 dark:bg-indigo-900/50 px-1 py-0.5 rounded">WEBHOOK_SECRET</code>{' '}
            environment variable to start populating the Work Board.
        </div>
    )
}

// ---------------------------------------------------------------------------
// Upsell card for tier-gated endpoints
// ---------------------------------------------------------------------------

function UpsellCard({ tier }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/20">
                <Lock className="w-7 h-7 text-white" />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
                {tier === 'enterprise' ? 'Enterprise' : 'Pro'} feature
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mb-4">
                Upgrade to {tier === 'enterprise' ? 'Enterprise' : 'Pro'} to unlock this view.
            </p>
            <a
                href="#pricing"
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors shadow-md shadow-indigo-500/25"
            >
                View pricing
            </a>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Tab: My Reviews
// ---------------------------------------------------------------------------

function MyReviewsTab() {
    const { data, loading, error, refresh } = useMyPendingReviews()
    const { params } = useWorkBoardFilters()
    const [optimisticallyRemoved, setOptimisticallyRemoved] = useState(() => new Set())
    const actions = useReviewAction({
        onOptimistic: (_action, args) => {
            setOptimisticallyRemoved(prev => {
                const next = new Set(prev)
                next.add(`${args.repoFullName}#${args.prNumber}`)
                return next
            })
        },
        onRollback: (_action, args) => {
            setOptimisticallyRemoved(prev => {
                const next = new Set(prev)
                next.delete(`${args.repoFullName}#${args.prNumber}`)
                return next
            })
        },
    })

    if (loading) return <SkeletonList count={5} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load reviews. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const filtered = applyFilters(data || [], params)
    const reviews = filtered.filter(r => !optimisticallyRemoved.has(`${r.repoFullName}#${r.prNumber}`))
    if (reviews.length === 0) {
        return (
            <>
                <EmptyState
                    icon={GitPullRequest}
                    title="No pending reviews"
                    subtitle="Great work! You have no open review requests right now."
                />
                <WebhookHint />
            </>
        )
    }

    return (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {reviews.map((r, i) => (
                <motion.a
                    key={`${r.repoFullName}-${r.prNumber}`}
                    href={`https://github.com/${r.repoFullName}/pull/${r.prNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                >
                    <div className="mt-0.5 p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex-shrink-0">
                        <GitPullRequest className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {r.title || `PR #${r.prNumber}`}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            <span className="font-mono text-indigo-600 dark:text-indigo-400">{r.repoFullName}</span>
                            {' '}#{r.prNumber}
                            {r.authorLogin && <> by <strong>{r.authorLogin}</strong></>}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                        <Clock className="w-3 h-3" />
                        {ageLabel(r.ageHours)}
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <InlineActions
                        onApprove={() => actions.approve({ repoFullName: r.repoFullName, prNumber: r.prNumber })}
                        onRequestChanges={() => {
                            const body = window.prompt('What needs changing?')
                            if (body && body.trim()) {
                                actions.requestChanges({ repoFullName: r.repoFullName, prNumber: r.prNumber, body })
                            }
                        }}
                        onSnooze={(hours) => actions.snooze({ repoFullName: r.repoFullName, prNumber: r.prNumber, hours })}
                    />
                </motion.a>
            ))}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Tab: Stale PRs
// ---------------------------------------------------------------------------

function StalePRsTab() {
    const [staleAfterDays, setStaleAfterDays] = useState(7)
    const { data, loading, error, refresh } = useStalePRs({ staleAfterDays })
    const { params } = useWorkBoardFilters()
    const [optimisticallyRemoved, setOptimisticallyRemoved] = useState(() => new Set())
    const actions = useReviewAction({
        onOptimistic: (_action, args) => {
            setOptimisticallyRemoved(prev => {
                const next = new Set(prev)
                next.add(`${args.repoFullName}#${args.prNumber}`)
                return next
            })
        },
        onRollback: (_action, args) => {
            setOptimisticallyRemoved(prev => {
                const next = new Set(prev)
                next.delete(`${args.repoFullName}#${args.prNumber}`)
                return next
            })
        },
    })

    if (loading) return <SkeletonList count={6} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load stale PRs. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const filtered = applyFilters(data || [], params)
    const prs = filtered.filter(p => !optimisticallyRemoved.has(`${p.repoFullName}#${p.prNumber}`))

    return (
        <>
            {/* Controls */}
            <div className="flex items-center gap-3 p-4 border-b border-slate-100 dark:border-slate-800/60">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    Stale after
                </label>
                <select
                    value={staleAfterDays}
                    onChange={e => setStaleAfterDays(Number(e.target.value))}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                    {[3, 7, 14, 30].map(d => (
                        <option key={d} value={d}>{d} days</option>
                    ))}
                </select>
            </div>

            {prs.length === 0 ? (
                <>
                    <EmptyState
                        icon={GitPullRequest}
                        title={`No PRs open for more than ${staleAfterDays} days`}
                        subtitle="Your team is on top of it!"
                    />
                    <WebhookHint />
                </>
            ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {prs.map((pr, i) => (
                        <motion.a
                            key={`${pr.repoFullName}-${pr.prNumber}`}
                            href={`https://github.com/${pr.repoFullName}/pull/${pr.prNumber}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.03 }}
                            className="flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                        >
                            <div className="mt-0.5 p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex-shrink-0">
                                <AlertTriangle className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                    {pr.title || `PR #${pr.prNumber}`}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    <span className="font-mono text-indigo-600 dark:text-indigo-400">{pr.repoFullName}</span>
                                    {' '}#{pr.prNumber}
                                    {pr.authorLogin && <> by <strong>{pr.authorLogin}</strong></>}
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap flex-shrink-0">
                                <Clock className="w-3 h-3" />
                                {dayLabel(pr.ageDays)}
                                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <InlineActions
                                onSnooze={(hours) => actions.snooze({ repoFullName: pr.repoFullName, prNumber: pr.prNumber, hours })}
                            />
                        </motion.a>
                    ))}
                </div>
            )}
        </>
    )
}

// ---------------------------------------------------------------------------
// Tab: My Issues
// ---------------------------------------------------------------------------

function MyIssuesTab() {
    const { data, loading, error, refresh } = useMyOpenIssues()
    const { params } = useWorkBoardFilters()

    if (loading) return <SkeletonList count={4} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load issues. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const issues = applyFilters(data || [], params)
    if (issues.length === 0) {
        return (
            <>
                <EmptyState
                    icon={CircleDot}
                    title="No open issues assigned to you"
                    subtitle="Nothing on your plate right now."
                />
                <WebhookHint />
            </>
        )
    }

    return (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {issues.map((issue, i) => (
                <motion.a
                    key={`${issue.repoFullName}-${issue.issueNumber}`}
                    href={`https://github.com/${issue.repoFullName}/issues/${issue.issueNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                >
                    <div className="mt-0.5 p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                        <CircleDot className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {issue.title || `Issue #${issue.issueNumber}`}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-indigo-600 dark:text-indigo-400">{issue.repoFullName}</span>
                            #{issue.issueNumber}
                            {(issue.labels || []).map(label => (
                                <span
                                    key={label}
                                    className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-medium"
                                >
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                        <Clock className="w-3 h-3" />
                        {dayLabel(issue.ageDays)}
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                </motion.a>
            ))}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Tab: DORA Metrics
// ---------------------------------------------------------------------------

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
        <div className="flex-1 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/40 text-center">
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value ?? '—'}</div>
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-0.5">{label}</div>
            {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
        </div>
    )
}

function hoursLabel(h) {
    if (h == null) return '—'
    if (h < 1) return `${Math.round(h * 60)}m`
    if (h < 48) return `${Math.round(h)}h`
    return `${Math.round(h / 24)}d`
}

function DORATab() {
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
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/40">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                        Daily successful deploys (last 30 days)
                    </div>
                    <SparkLine perDay={perDay} />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                        <span>{perDay[0]?.date}</span>
                        <span>{perDay[perDay.length - 1]?.date}</span>
                    </div>
                </div>
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

// ---------------------------------------------------------------------------
// Tab: Review Load
// ---------------------------------------------------------------------------

function ReviewLoadTab() {
    const { data, loading, error, refresh } = useReviewLoad()

    if (loading) return <SkeletonList count={5} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load review load. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const reviewers = Array.isArray(data) ? data : []
    if (reviewers.length === 0) {
        return (
            <>
                <EmptyState
                    icon={Users}
                    title="No review assignments yet"
                    subtitle="Once GitHub starts sending review_requested events, each reviewer's open + completed counts show up here."
                />
                <WebhookHint />
            </>
        )
    }

    const maxCombined = Math.max(
        ...reviewers.map(r => (r.reviewsSubmitted || 0) + (r.reviewsPending || 0)),
        1
    )

    return (
        <div className="p-4 space-y-3">
            <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Users className="w-3.5 h-3.5" />
                <span>Review load — last 30 days</span>
                <span className="ml-auto flex items-center gap-3 normal-case font-medium text-[10px]">
                    <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-emerald-500" />
                        Submitted
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm bg-amber-500" />
                        Pending
                    </span>
                </span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/40 overflow-hidden">
                {reviewers.map((r, i) => {
                    const submitted = r.reviewsSubmitted || 0
                    const pending = r.reviewsPending || 0
                    const total = submitted + pending
                    const submittedPct = total ? (submitted / maxCombined) * 100 : 0
                    const pendingPct = total ? (pending / maxCombined) * 100 : 0
                    return (
                        <motion.div
                            key={r.reviewerLogin}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(i * 0.03, 0.3) }}
                            className="flex items-center gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors bg-white/60 dark:bg-slate-900/40"
                        >
                            <div className="w-32 shrink-0 truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                                {r.reviewerLogin}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div
                                    className="flex h-2.5 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800"
                                    role="img"
                                    aria-label={`${r.reviewerLogin}: ${submitted} submitted, ${pending} pending`}
                                >
                                    {submittedPct > 0 && (
                                        <div
                                            className="bg-emerald-500 dark:bg-emerald-500/90"
                                            style={{ width: `${submittedPct}%` }}
                                        />
                                    )}
                                    {pendingPct > 0 && (
                                        <div
                                            className="bg-amber-500 dark:bg-amber-500/90"
                                            style={{ width: `${pendingPct}%` }}
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums w-24 text-right">
                                <span className="text-emerald-600 dark:text-emerald-400">{submitted}</span>
                                <span className="text-slate-400 mx-1">·</span>
                                <span className="text-amber-600 dark:text-amber-400">{pending}</span>
                            </div>
                        </motion.div>
                    )
                })}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Tab: Tech Debt
// ---------------------------------------------------------------------------

function TechDebtTab() {
    const { data, loading, error, refresh } = useTechDebt()
    const { params } = useWorkBoardFilters()

    if (loading) return <SkeletonList count={5} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load tech debt. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const items = applyFilters(data?.items || [], params)
    const hotspots = data?.hotspots || []

    if (items.length === 0) {
        return (
            <>
                <EmptyState
                    icon={Wrench}
                    title="No tech debt tracked"
                    subtitle="Label issues with tech-debt, refactor, debt or cleanup and they'll appear here across all repos."
                />
                <WebhookHint />
            </>
        )
    }

    return (
        <div className="space-y-4 p-4">
            {/* Hotspots */}
            {hotspots.length > 0 && (
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40">
                    <div className="flex items-center gap-2 mb-2">
                        <Flame className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                            Hotspots
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {hotspots.slice(0, 6).map(h => (
                            <span
                                key={h.repoFullName}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/80 dark:bg-slate-900/60 text-xs font-medium text-slate-700 dark:text-slate-200"
                            >
                                <span className="font-mono text-indigo-600 dark:text-indigo-400">{h.repoFullName}</span>
                                <span className="text-amber-600 dark:text-amber-400 font-semibold">{h.count}</span>
                                {h.oldestAgeDays > 0 && (
                                    <span className="text-slate-400 text-[10px]">· oldest {Math.round(h.oldestAgeDays)}d</span>
                                )}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Issues */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/40 overflow-hidden">
                {items.map((issue, i) => (
                    <motion.a
                        key={`${issue.repoFullName}-${issue.issueNumber}`}
                        href={`https://github.com/${issue.repoFullName}/issues/${issue.issueNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.02, 0.3) }}
                        className="flex items-start gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group bg-white/60 dark:bg-slate-900/40"
                    >
                        <div className="mt-0.5 p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex-shrink-0">
                            <Wrench className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {issue.title || `Issue #${issue.issueNumber}`}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-indigo-600 dark:text-indigo-400">{issue.repoFullName}</span>
                                #{issue.issueNumber}
                                {(issue.labels || []).slice(0, 3).map(label => (
                                    <span
                                        key={label}
                                        className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-medium"
                                    >
                                        {label}
                                    </span>
                                ))}
                                {issue.assignees?.length > 0 && (
                                    <span className="text-[10px] text-slate-400">
                                        → {issue.assignees.slice(0, 2).join(', ')}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap flex-shrink-0">
                            <Clock className="w-3 h-3" />
                            {dayLabel(issue.ageDays)}
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                    </motion.a>
                ))}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

// g-prefix keyboard navigation — maps second-key to tab id
const TAB_KEYS = { r: 'reviews', s: 'stale', i: 'issues', l: 'reviewload', t: 'techdebt', d: 'dora' }

const TABS = [
    { id: 'reviews',     label: 'My Reviews',  icon: GitPullRequest, component: MyReviewsTab, accent: 'purple' },
    { id: 'stale',       label: 'Stale PRs',   icon: AlertTriangle,  component: StalePRsTab,  accent: 'amber' },
    { id: 'issues',      label: 'My Issues',   icon: CircleDot,      component: MyIssuesTab,  accent: 'emerald' },
    { id: 'reviewload',  label: 'Review Load', icon: Users,          component: ReviewLoadTab, badge: 'Pro', accent: 'sky' },
    { id: 'techdebt',    label: 'Tech Debt',   icon: Wrench,         component: TechDebtTab, badge: 'Pro', accent: 'amber' },
    { id: 'dora',        label: 'DORA',        icon: BarChart3,      component: DORATab, badge: 'Enterprise', accent: 'indigo' },
]

// ---------------------------------------------------------------------------
// KPI summary row — quick counts across the four primary tabs
// ---------------------------------------------------------------------------

const KPI_ACCENTS = {
    purple:  { ring: 'from-purple-500/20',  dot: 'bg-purple-500',  text: 'text-purple-600 dark:text-purple-300' },
    amber:   { ring: 'from-amber-500/20',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-300' },
    emerald: { ring: 'from-emerald-500/20', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-300' },
    indigo:  { ring: 'from-indigo-500/20',  dot: 'bg-indigo-500',  text: 'text-indigo-600 dark:text-indigo-300' },
}

function KpiTile({ icon: Icon, label, value, hint, loading, accent = 'indigo', onClick, active }) {
    const a = KPI_ACCENTS[accent] || KPI_ACCENTS.indigo
    return (
        <button
            type="button"
            onClick={onClick}
            className={`
                group relative text-left p-5 rounded-2xl border backdrop-blur-xl overflow-hidden
                transition-all duration-300 ds-hover-lift
                ${active
                    ? 'border-indigo-400/60 dark:border-indigo-500/50 bg-white dark:bg-slate-900 shadow-lg shadow-indigo-500/10'
                    : 'border-slate-200/60 dark:border-slate-700/40 bg-white/70 dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-600'
                }
            `}
        >
            <div className={`absolute -top-10 -right-10 w-28 h-28 rounded-full bg-gradient-to-br ${a.ring} to-transparent blur-2xl opacity-70 group-hover:opacity-100 transition-opacity`} />
            <div className="relative flex items-start justify-between gap-3">
                <div className={`p-2 rounded-xl bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 border border-slate-200/60 dark:border-slate-700/50 ${a.text}`}>
                    <Icon className="w-4 h-4" />
                </div>
                <span className={`w-1.5 h-1.5 rounded-full ${a.dot} mt-2 opacity-70`} />
            </div>
            <div className="relative mt-4">
                <div className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50 ds-font-display leading-none">
                    {loading ? <span className="inline-block w-10 h-7 rounded-md bg-slate-200 dark:bg-slate-700 animate-pulse" /> : (value ?? 0)}
                </div>
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {label}
                </div>
                {hint && <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>}
            </div>
        </button>
    )
}

function KpiRow({ activeTab, setActiveTab, reviews, stale, issues, debt }) {
    const reviewsCount = Array.isArray(reviews.data) ? reviews.data.length : 0
    const staleCount = Array.isArray(stale.data) ? stale.data.length : 0
    const issuesCount = Array.isArray(issues.data) ? issues.data.length : 0
    const debtCount = debt.data?.items?.length ?? 0

    const oldestReviewHours = reviewsCount > 0
        ? Math.max(...reviews.data.map(r => r.ageHours || 0))
        : 0
    const oldestStaleDays = staleCount > 0
        ? Math.max(...stale.data.map(p => p.ageDays || 0))
        : 0
    const hotspotRepo = debt.data?.hotspots?.[0]?.repoFullName || null

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiTile
                icon={GitPullRequest}
                label="Pending reviews"
                value={reviewsCount}
                hint={reviewsCount > 0 ? `oldest ${ageLabel(oldestReviewHours)}` : 'all caught up'}
                loading={reviews.loading}
                accent="purple"
                active={activeTab === 'reviews'}
                onClick={() => setActiveTab('reviews')}
            />
            <KpiTile
                icon={AlertTriangle}
                label="Stale PRs"
                value={staleCount}
                hint={staleCount > 0 ? `oldest ${dayLabel(oldestStaleDays)}` : 'nothing stale'}
                loading={stale.loading}
                accent="amber"
                active={activeTab === 'stale'}
                onClick={() => setActiveTab('stale')}
            />
            <KpiTile
                icon={CircleDot}
                label="Open issues"
                value={issuesCount}
                hint={issuesCount > 0 ? 'assigned to you' : 'nothing on your plate'}
                loading={issues.loading}
                accent="emerald"
                active={activeTab === 'issues'}
                onClick={() => setActiveTab('issues')}
            />
            <KpiTile
                icon={Wrench}
                label="Tech debt"
                value={debtCount}
                hint={hotspotRepo ? `hotspot: ${hotspotRepo.split('/').pop()}` : 'no debt tracked'}
                loading={debt.loading}
                accent="indigo"
                active={activeTab === 'techdebt'}
                onClick={() => setActiveTab('techdebt')}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// WorkBoardPage
// ---------------------------------------------------------------------------

export function WorkBoardPage({ repoCount = 0 }) {
    const [params, setParams] = useUrlParams(['tab', 'repos', 'authors', 'labels', 'age', 'snoozed'])
    const activeTab = params.tab || 'reviews'
    const setActiveTab = (tab) => setParams({ tab: tab === 'reviews' ? '' : tab })

    // Help modal state (from centralized ModalContext)
    const { modalStates, openModal, closeModal } = useModal()
    const helpOpen = modalStates.workBoardHelp || false

    // `?` opens help (Shift+/ yields event.key === '?' on most layouts)
    useContextShortcut({ key: '?', handler: () => openModal('workBoardHelp') })
    // Escape closes help
    useContextShortcut({ key: 'Escape', handler: () => closeModal('workBoardHelp'), when: helpOpen, deps: [helpOpen] })

    // g-prefix tab navigation — press `g`, then a letter within 800ms
    const [pendingG, setPendingG] = useState(false)
    useContextShortcut({ key: 'g', handler: () => setPendingG(true) })

    useEffect(() => {
        if (!pendingG) return undefined
        let cancelled = false
        const timer = setTimeout(() => { if (!cancelled) setPendingG(false) }, 800)
        function h(e) {
            const tag = (e.target?.tagName || '').toLowerCase()
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) {
                setPendingG(false)
                return
            }
            if (e.metaKey || e.ctrlKey || e.altKey) {
                setPendingG(false)
                return
            }
            if (TAB_KEYS[e.key]) {
                e.preventDefault()
                setActiveTab(TAB_KEYS[e.key])
            }
            setPendingG(false)
        }
        window.addEventListener('keydown', h, { once: true })
        return () => {
            cancelled = true
            clearTimeout(timer)
            window.removeEventListener('keydown', h)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingG])

    const reviews = useMyPendingReviews()
    const stale = useStalePRs({ staleAfterDays: 7 })
    const issues = useMyOpenIssues()
    const debt = useTechDebt()

    // Aggregate filter options from the data loaded by all primary tabs.
    const allItems = [
        ...(Array.isArray(reviews.data) ? reviews.data : []),
        ...(Array.isArray(stale.data) ? stale.data : []),
        ...(Array.isArray(issues.data) ? issues.data : []),
        ...((debt.data?.items) || []),
    ]
    const availableRepos = Array.from(new Set(allItems.map(i => i.repoFullName).filter(Boolean))).sort()
    const availableAuthors = Array.from(new Set(allItems.map(i => i.authorLogin).filter(Boolean))).sort()
    const availableLabels = Array.from(new Set(allItems.flatMap(i => i.labels || []).filter(Boolean))).sort()

    const earliest = (() => {
        const times = [reviews.lastFetchedAt, stale.lastFetchedAt, issues.lastFetchedAt, debt.lastFetchedAt]
            .filter(Boolean)
            .map(d => d.getTime())
        return times.length > 0 ? new Date(Math.min(...times)) : null
    })()
    const earliestLabel = useRelativeTime(earliest)

    const [refreshing, setRefreshing] = useState(false)
    const refreshAll = async () => {
        setRefreshing(true)
        try {
            await Promise.all([
                reviews.refresh?.(),
                stale.refresh?.(),
                issues.refresh?.(),
                debt.refresh?.(),
            ])
        } finally {
            setRefreshing(false)
        }
    }

    const ActiveComponent = TABS.find(t => t.id === activeTab)?.component || MyReviewsTab

    return (
        <div className="max-w-6xl mx-auto space-y-7 animate-in fade-in duration-500 px-1">
            {/* Header */}
            <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                    <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500 dark:text-indigo-400 mb-2">
                        <span className="w-6 h-px bg-gradient-to-r from-transparent via-indigo-400 to-indigo-500" />
                        Cross-Repo Activity
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold ds-font-display ds-gradient-text leading-tight">
                        Work Board
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                        {repoCount > 0
                            ? `${repoCount} repos tracked · live signals across reviews, issues & delivery`
                            : 'Live signals across reviews, issues & delivery'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {earliest && (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500" aria-live="polite">
                            updated {earliestLabel}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={refreshAll}
                        disabled={refreshing}
                        aria-label="Refresh work board"
                        className="p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/70 dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                        <motion.div animate={{ rotate: refreshing ? 360 : 0 }} transition={{ duration: 0.6, ease: 'easeInOut' }}>
                            <RefreshCw className="w-4 h-4" />
                        </motion.div>
                    </button>
                </div>
            </div>

            {/* AI summary card — silently hides when ai_not_configured */}
            <AISummaryCard />

            {/* KPI row */}
            <KpiRow
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                reviews={reviews}
                stale={stale}
                issues={issues}
                debt={debt}
            />

            <FilterProvider
                params={params}
                availableRepos={availableRepos}
                availableAuthors={availableAuthors}
                availableLabels={availableLabels}
            >
            {/* Filter bar (URL-synced) */}
            <WorkBoardFilterBar
                filters={params}
                setFilters={setParams}
                availableRepos={availableRepos}
                availableAuthors={availableAuthors}
                availableLabels={availableLabels}
            >
                <PresetDropdown currentFilters={params} onApply={setParams} />
            </WorkBoardFilterBar>

            {/* Main card */}
            <div className="relative rounded-3xl border border-slate-200/60 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl shadow-slate-300/20 dark:shadow-black/40 overflow-hidden">
                <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] h-[220px] rounded-full bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-transparent blur-3xl" />

                {/* Tab bar */}
                <div role="tablist" aria-label="Work Board sections" className="relative flex items-center gap-1 p-2.5 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/60 dark:bg-slate-800/30 overflow-x-auto">
                    {TABS.map(tab => {
                        const Icon = tab.icon
                        const isActive = activeTab === tab.id
                        return (
                            <button
                                key={tab.id}
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                                    relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200
                                    ${isActive
                                        ? 'bg-gradient-to-br from-white to-slate-50 dark:from-slate-700 dark:to-slate-800 text-indigo-600 dark:text-indigo-300 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500/20'
                                        : 'text-slate-500 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-slate-700/50 hover:text-slate-700 dark:hover:text-slate-200'
                                    }
                                `}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                                {tab.badge && (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                        tab.badge === 'Enterprise'
                                            ? 'bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40 text-amber-700 dark:text-amber-300'
                                            : 'bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/50 dark:to-purple-900/50 text-indigo-600 dark:text-indigo-300'
                                    }`}>
                                        {tab.badge}
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>

                {/* Tab content */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18 }}
                        className="min-h-[380px]"
                    >
                        <ActiveComponent />
                    </motion.div>
                </AnimatePresence>
            </div>
            </FilterProvider>

            <KeyboardHelpModal open={helpOpen} onClose={() => closeModal('workBoardHelp')} />
        </div>
    )
}
