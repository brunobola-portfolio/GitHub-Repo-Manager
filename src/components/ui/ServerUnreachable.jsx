import { useEffect, useRef, useState } from 'react'
import { RefreshCw, ServerOff } from 'lucide-react'
import { Button } from './Button'

// 5 s, 10 s, 20 s, then every 30 s: quick enough to catch the end of a deploy
// restart, slow enough not to lean on a rate limiter that is already saying
// no. After the sixth miss the page stops pretending it is a blip and offers
// a full reload, which also clears any stale in-memory state.
const BACKOFF_MS = [5000, 10000, 20000, 30000]
const OFFER_RELOAD_AFTER = 6

function delayFor(attempt) {
    return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
}

/**
 * Shown when /api/system/status cannot be read at boot — a deploy restart, an
 * IIS recycle, a network blip. It is deliberately NOT the first-run wizard:
 * "the server did not answer" and "the system is not initialised" are
 * different facts, and treating the first as the second greeted the owner
 * of a freshly deployed 4.24.0 with "Creating SQLite Database" and a 403.
 */
export function ServerUnreachable({ onRetry, backoffMs }) {
    const [attempt, setAttempt] = useState(0)
    const schedule = backoffMs || BACKOFF_MS
    const attemptRef = useRef(0)

    useEffect(() => {
        if (!onRetry) return undefined
        let id
        const tick = () => {
            attemptRef.current += 1
            setAttempt(attemptRef.current)
            onRetry()
            id = setTimeout(tick, schedule[Math.min(attemptRef.current, schedule.length - 1)])
        }
        id = setTimeout(tick, schedule[0])
        return () => clearTimeout(id)
    }, [onRetry, schedule])

    const stubborn = attempt >= OFFER_RELOAD_AFTER
    const nextIn = Math.round(delayFor(attempt) / 1000)

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
                    {stubborn
                        ? `Still no answer after ${attempt} attempts. The service may be down or your connection may be blocked — reloading the page starts from a clean slate.`
                        : `It may be restarting after an update. Retrying on its own${attempt > 0 ? ` (${attempt} so far, next in ${nextIn} s)` : ''}.`}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button variant="secondary" size="sm" onClick={onRetry} className="gap-2">
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        Retry now
                    </Button>
                    {stubborn && (
                        <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
                            Reload the page
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

export default ServerUnreachable
