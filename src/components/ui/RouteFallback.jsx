import { Spinner } from './Spinner'

/**
 * RouteFallback — lightweight spinner shown while a lazy route chunk loads.
 *
 * Uses the shared <Spinner> (pure inline SVG, no icon library) so route
 * transitions match every other loading state in the app.
 *
 * Use `variant="page"` for full-route transitions (default) and
 * `variant="inline"` inside smaller containers (modals, drawers).
 */
export function RouteFallback({ variant = 'page', label = 'Loading…' }) {
    if (variant === 'inline') {
        return (
            <div
                className="flex items-center justify-center py-6"
                role="status"
                aria-live="polite"
            >
                <Spinner size="lg" tone="primary" label={label} />
                <span className="sr-only">{label}</span>
            </div>
        )
    }

    return (
        <div
            className="flex items-center justify-center min-h-[400px]"
            role="status"
            aria-live="polite"
        >
            <div className="text-center">
                <Spinner size="xl" tone="primary" label={label} className="mx-auto mb-3" />
                <p className="text-slate-500 dark:text-slate-400 text-sm">{label}</p>
            </div>
        </div>
    )
}

export default RouteFallback
