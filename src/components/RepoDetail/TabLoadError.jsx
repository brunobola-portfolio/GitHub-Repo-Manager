import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'

/**
 * Shared load-failure state for the RepoDetail tabs.
 *
 * Exists because four tabs (Branches, Releases, Issues, Pull Requests) never
 * destructured `error` from useTabData and rendered their normal empty state
 * instead — telling the user, as fact, that a repository has no branches when
 * GitHub had actually 500'd or the token had expired. Nothing looked broken,
 * so nobody pressed Refresh.
 *
 * A 404 genuinely means "this repo has no such resource", so callers pass
 * `notFound` to keep their own honest empty state for that one case.
 */
export function TabLoadError({ error, onRetry, resourceLabel, notFound = null }) {
    if (!error) return null

    if (error.status === 404 && notFound) return notFound

    if (error.status === 401 || error.status === 403) {
        return (
            <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl text-sm text-amber-700 dark:text-amber-400 flex items-center justify-between gap-3 flex-wrap">
                <span>Sign in again to view {resourceLabel}.</span>
                <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => { window.location.href = '/api/auth/github' }}
                >
                    Sign in
                </Button>
            </div>
        )
    }

    if (error.status === 404) {
        return (
            <EmptyState
                title={`No ${resourceLabel}`}
                description={`GitHub returned no ${resourceLabel} for this repository.`}
            />
        )
    }

    return (
        <div className="px-4 py-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 rounded-xl text-sm text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3 flex-wrap">
            <span>Couldn&apos;t load {resourceLabel}.</span>
            {onRetry && (
                <Button variant="secondary" size="xs" onClick={onRetry}>
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    Retry
                </Button>
            )}
        </div>
    )
}
