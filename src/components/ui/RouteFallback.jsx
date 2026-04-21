/**
 * RouteFallback — lightweight spinner shown while a lazy route chunk loads.
 *
 * Intentionally has NO dependencies on heavy modules (motion, lucide, etc.) so
 * it can be bundled into the main entry chunk with zero cost — that's what
 * makes it suitable as a Suspense fallback for route-level code splitting.
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
                <div
                    className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"
                    aria-hidden="true"
                />
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
                <div
                    className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"
                    aria-hidden="true"
                />
                <p className="text-slate-500 dark:text-slate-400 text-sm">{label}</p>
            </div>
        </div>
    )
}

export default RouteFallback
