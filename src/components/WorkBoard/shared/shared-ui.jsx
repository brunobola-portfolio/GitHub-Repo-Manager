/**
 * Shared presentational bits for the Work Board tabs.
 * Kept free of tab-specific state so they can be re-used without triggering
 * circular imports.
 */

import { UpgradeRequired } from '../../states'
import { Skeleton } from '../../ui/Skeleton'
import { EmptyState as CanonicalEmptyState } from '../../ui/EmptyState'

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
// Empty state — thin adapter over the canonical <EmptyState> primitive
// (src/components/ui/EmptyState.jsx) instead of a local fork, so Work Board
// tabs share the same entrance motion, icon tile, and CTA support as the
// other 29+ consumers. `subtitle` maps to the canonical `description` prop
// so call sites here don't need to change.
// ---------------------------------------------------------------------------

export function EmptyState({ icon, title, subtitle, ...rest }) {
    return <CanonicalEmptyState icon={icon} title={title} description={subtitle} {...rest} />
}

// ---------------------------------------------------------------------------
// Error state — distinguishes an expired session (401) from a generic load
// failure so a tab never renders a misleading "retry" on a request that will
// keep failing until the user signs in again. Tier-gated 403s stay at the call
// site (they map to <UpsellCard> with a tier-specific message).
// ---------------------------------------------------------------------------

export function ErrorState({ error, what = 'data', onRetry }) {
    if (error?.status === 401) {
        return (
            <div className="p-4 text-sm text-amber-700 dark:text-amber-300">
                Your session has expired.{' '}
                <button onClick={() => window.location.reload()} className="underline font-medium">
                    Refresh to sign in
                </button>
            </div>
        )
    }
    return (
        <div className="p-4 text-sm text-rose-600 dark:text-rose-400">
            Failed to load {what}.{' '}
            {onRetry && <button onClick={onRetry} className="underline">Retry</button>}
        </div>
    )
}

// ---------------------------------------------------------------------------
// No-data hint (webhook not yet configured)
// ---------------------------------------------------------------------------

export function WebhookHint() {
    return (
        <div className="mt-3 p-4 rounded-xl bg-brand-50 dark:bg-brand-950/30 border border-brand-200/60 dark:border-brand-800/50 text-sm text-brand-700 dark:text-brand-300">
            <strong>No data yet.</strong> Connect a GitHub webhook at{' '}
            <code className="text-xs bg-brand-100 dark:bg-brand-900/50 px-1 py-0.5 rounded">
                /api/v1/webhooks/github
            </code>{' '}
            with a <code className="text-xs bg-brand-100 dark:bg-brand-900/50 px-1 py-0.5 rounded">WEBHOOK_SECRET</code>{' '}
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
