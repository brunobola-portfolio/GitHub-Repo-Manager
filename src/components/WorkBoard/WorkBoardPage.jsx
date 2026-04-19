/**
 * Cross-Repo Work Board — Phase E3
 *
 * Tabs:
 *   1. My Reviews   — pending review assignments (Free+)
 *   2. Stale PRs    — PRs open > N days (Pro+)
 *   3. My Issues    — assigned open issues (Free+)
 *   4. DORA         — deploy freq + lead time (Enterprise+)
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    GitPullRequest, CircleDot, Rocket, BarChart3,
    ExternalLink, Clock, AlertTriangle, Lock, RefreshCw,
} from 'lucide-react'
import {
    useMyPendingReviews,
    useStalePRs,
    useMyOpenIssues,
    useDORAMetrics,
} from '../../hooks/useWorkBoard'

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
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                <Icon className="w-7 h-7 opacity-40" />
            </div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">{title}</p>
            {subtitle && <p className="text-xs text-center max-w-xs">{subtitle}</p>}
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

    if (loading) return <SkeletonList count={5} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load reviews. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const reviews = data || []
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
                    className="flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
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

    if (loading) return <SkeletonList count={6} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load stale PRs. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const prs = data || []

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
                            className="flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
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

    if (loading) return <SkeletonList count={4} />
    if (error) {
        if (error.status === 403) return <UpsellCard tier="pro" />
        return (
            <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
                Failed to load issues. <button onClick={refresh} className="underline">Retry</button>
            </div>
        )
    }

    const issues = data || []
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
                    className="flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
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

function DORATab() {
    const { data, loading, error, refresh } = useDORAMetrics({ environment: 'production' })

    if (loading) {
        return (
            <div className="p-6 space-y-4 animate-pulse">
                <div className="flex gap-3">
                    {[1, 2, 3].map(i => <div key={i} className="flex-1 h-20 rounded-2xl bg-slate-200 dark:bg-slate-700" />)}
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

    const metrics = data || {}
    const totalDeployments = metrics.totalDeployments ?? 0
    const perDay = metrics.perDay || []
    const medianHours = metrics.medianLeadTimeHours ?? metrics.medianHours ?? null
    const medianDisplay = medianHours != null ? `${Math.round(medianHours)}h` : '—'

    return (
        <div className="p-6 space-y-5">
            {/* KPIs */}
            <div className="flex gap-3">
                <KPI
                    label="Deployments (30d)"
                    value={totalDeployments}
                    sub="production"
                />
                <KPI
                    label="Median lead time"
                    value={medianDisplay}
                    sub="PR open → merged"
                />
                <KPI
                    label="Avg deploys / day"
                    value={perDay.length > 0
                        ? (totalDeployments / perDay.length).toFixed(1)
                        : '—'
                    }
                    sub="30-day window"
                />
            </div>

            {/* Sparkline */}
            {perDay.length > 0 ? (
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/40">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                        Daily deploy frequency (last 30 days)
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
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
    { id: 'reviews',  label: 'My Reviews',  icon: GitPullRequest, component: MyReviewsTab },
    { id: 'stale',    label: 'Stale PRs',   icon: AlertTriangle,  component: StalePRsTab  },
    { id: 'issues',   label: 'My Issues',   icon: CircleDot,      component: MyIssuesTab  },
    { id: 'dora',     label: 'DORA',        icon: BarChart3,      component: DORATab, badge: 'Enterprise' },
]

// ---------------------------------------------------------------------------
// WorkBoardPage
// ---------------------------------------------------------------------------

export function WorkBoardPage({ repoCount = 0 }) {
    const [activeTab, setActiveTab] = useState('reviews')

    const ActiveComponent = TABS.find(t => t.id === activeTab)?.component || MyReviewsTab

    return (
        <div className="max-w-4xl mx-auto space-y-5 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 ds-font-display">
                        Work Board
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        {repoCount > 0 ? `${repoCount} repos tracked` : 'Cross-repo activity across all your repos'}
                    </p>
                </div>
            </div>

            {/* Main card */}
            <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-lg shadow-slate-200/30 dark:shadow-black/30 overflow-hidden">
                {/* Tab bar */}
                <div className="flex items-center gap-0.5 p-2 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/80 dark:bg-slate-800/40 overflow-x-auto">
                    {TABS.map(tab => {
                        const Icon = tab.icon
                        const isActive = activeTab === tab.id
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                                    flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200
                                    ${isActive
                                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                        : 'text-slate-500 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-slate-700/50 hover:text-slate-700 dark:hover:text-slate-300'
                                    }
                                `}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                                {tab.badge && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/50 dark:to-purple-900/50 text-indigo-600 dark:text-indigo-400">
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
                        transition={{ duration: 0.15 }}
                        className="min-h-[320px]"
                    >
                        <ActiveComponent />
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    )
}
