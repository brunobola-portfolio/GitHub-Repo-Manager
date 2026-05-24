// SPDX-License-Identifier: AGPL-3.0-only
import { CloudOff, RefreshCw } from 'lucide-react'

function formatRelative(fetchedAt) {
    if (!fetchedAt) return null
    // Server emits "YYYY-MM-DD HH:MM:SS" UTC — append 'Z' so JS parses it as UTC.
    const dt = new Date(fetchedAt.replace(' ', 'T') + 'Z')
    if (Number.isNaN(dt.getTime())) return null
    const ageSec = Math.max(0, Math.round((Date.now() - dt.getTime()) / 1000))
    if (ageSec < 60) return 'just now'
    if (ageSec < 3600) return `${Math.floor(ageSec / 60)} min ago`
    if (ageSec < 86400) return `${Math.floor(ageSec / 3600)} h ago`
    return `${Math.floor(ageSec / 86400)} d ago`
}

/**
 * StaleDataBadge — shown when the server returned cached data because the
 * live GitHub call failed. Linear-style subtle pill plus a retry button.
 */
export function StaleDataBadge({ fetchedAt, onRetry, className = '' }) {
    const relative = formatRelative(fetchedAt)
    return (
        <div
            data-testid="stale-data-badge"
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full ds-text-meta font-medium bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 text-amber-700 dark:text-amber-300 ${className}`}
        >
            <CloudOff className="w-3 h-3" aria-hidden="true" />
            <span>
                Showing cached data{relative ? ` · ${relative}` : ''}
            </span>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                    aria-label="Retry"
                >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                </button>
            )}
        </div>
    )
}
