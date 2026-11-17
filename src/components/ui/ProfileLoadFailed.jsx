import { UserX, RefreshCw, LogOut } from 'lucide-react'
import { Button } from './Button'

/**
 * Shown when the app session is valid but the GitHub profile could not be
 * loaded (a GitHub 5xx after retries). The shell used to fall through to the
 * landing page, which offered "Sign in" to someone already signed in and
 * hid the error that explained what happened.
 *
 * A 429 is this app's own request limit, not GitHub: it used to read "GitHub
 * did not answer (Rate limit exceeded)", which sent people to check GitHub.
 */
export function ProfileLoadFailed({ message, status, onRetry, onSignOut }) {
    const limited = status === 429
    return (
        <div role="alert" className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6">
            <div className="flex flex-col items-center text-center max-w-sm gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400">
                    <UserX className="h-7 w-7" aria-hidden="true" />
                </div>
                <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {limited ? 'Too many requests for a moment' : <>Couldn&rsquo;t load your GitHub profile</>}
                </h1>
                <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    {limited
                        ? 'You are signed in. Repo Manager limits how many requests one account can make in a short window, and that window is used up. It frees up within a few minutes; Try again works as soon as it does.'
                        : <>You are signed in, but GitHub did not answer. {message ? `(${message})` : ''} This is usually brief.</>}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button variant="primary" size="sm" onClick={onRetry} className="gap-2">
                        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
                    </Button>
                    {onSignOut && (
                        <Button variant="secondary" size="sm" onClick={onSignOut} className="gap-2">
                            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}
