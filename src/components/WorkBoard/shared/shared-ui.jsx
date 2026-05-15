/**
 * Shared presentational bits for the Work Board tabs.
 * Kept free of tab-specific state so they can be re-used without triggering
 * circular imports.
 */

import { UpgradeRequired } from '../../states'
import { Skeleton } from '../../ui/Skeleton'

// ---------------------------------------------------------------------------
// Skeleton — composed from the canonical <Skeleton> primitive so every
// loading row in WorkBoard shares the same shimmer treatment.
// ---------------------------------------------------------------------------

export function SkeletonRow() {
    return (
        <div className="flex items-start gap-3 p-4">
            <Skeleton className="w-8 h-8 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-3 w-16" />
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
        <div data-testid="empty-state" className="flex flex-col items-center justify-center py-20 px-6 text-slate-400">
            <div className="relative w-20 h-20 mb-5">
                <div className="relative w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/50 flex items-center justify-center shadow-sm">
                    <Icon className="w-9 h-9 text-slate-400 dark:text-slate-500" />
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
// Thin wrapper over the canonical <UpgradeRequired/> primitive in
// src/components/states so all gated surfaces share the same look.
// ---------------------------------------------------------------------------

export function UpsellCard({ tier, feature, benefits }) {
    return <UpgradeRequired tier={tier} feature={feature} benefits={benefits} />
}
