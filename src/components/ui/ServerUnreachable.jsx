import { useEffect, useState } from 'react'
import { RefreshCw, ServerOff } from 'lucide-react'
import { Button } from './Button'

const RETRY_EVERY_MS = 5000

/**
 * Shown when /api/system/status cannot be read at boot — a deploy restart, an
 * IIS recycle, a network blip. It is deliberately NOT the first-run wizard:
 * "the server did not answer" and "the system is not initialised" are
 * different facts, and treating the first as the second greeted the owner
 * of a freshly deployed 4.24.0 with "Creating SQLite Database" and a 403.
 *
 * Retries on its own so a restart window resolves without a click.
 */
export function ServerUnreachable({ onRetry, retryEveryMs = RETRY_EVERY_MS }) {
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        if (!onRetry) return undefined
        const id = setInterval(() => {
            setAttempt((n) => n + 1)
            onRetry()
        }, retryEveryMs)
        return () => clearInterval(id)
    }, [onRetry, retryEveryMs])

    return (
        <div
            role="status"
            aria-live="polite"
            className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-6"
        >
            <div className="flex flex-col items-center text-center max-w-sm gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400">
                    <ServerOff className="h-7 w-7" aria-hidden="true" />
                </div>
                <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    Can&rsquo;t reach the server
                </h1>
                <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    It may be restarting after an update. This page retries on its own every few seconds
                    {attempt > 0 ? ` (${attempt} so far)` : ''}.
                </p>
                <Button variant="secondary" size="sm" onClick={onRetry} className="gap-2">
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    Retry now
                </Button>
            </div>
        </div>
    )
}

export default ServerUnreachable
