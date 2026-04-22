/**
 * Shared presentational bits for the Work Board tabs.
 * Kept free of tab-specific state so they can be re-used without triggering
 * circular imports.
 */

import { Lock } from 'lucide-react'

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function SkeletonRow() {
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

export function SkeletonList({ count = 5 }) {
    return (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {Array.from({ length: count }, (_, i) => <SkeletonRow key={i} />)}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({ icon: Icon, title, subtitle }) {
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

export function WebhookHint() {
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

export function UpsellCard({ tier }) {
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
