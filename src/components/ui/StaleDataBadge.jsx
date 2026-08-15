// SPDX-License-Identifier: Apache-2.0
import { CloudOff, RefreshCw } from 'lucide-react'
import { formatRelativeTime } from '../../utils/format'

/**
 * StaleDataBadge — shown when the server returned cached data because the
 * live GitHub call failed. Linear-style subtle pill plus a retry button.
 */
export function StaleDataBadge({ fetchedAt, onRetry, className = '' }) {
    const relative = formatRelativeTime(fetchedAt)
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
