/**
 * Public, unauthenticated status page mounted at /status.
 *
 * Polls /api/health/ready directly (the endpoint is public by design) and
 * reports an overall system status pill plus a per-dependency breakdown.
 * Rendered standalone from main.jsx — no sidebar, header or auth context.
 *
 * Deliberately minimal: no framer-motion, no charts, just Tailwind + inline
 * SVG so the /status chunk stays tiny for use during incidents when the
 * rest of the app may be misbehaving.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { MOCK_MODE } from '../../config'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'

const POLL_INTERVAL_MS = 60_000

const STATUS_META = {
    ready: {
        label: 'All systems operational',
        pill: 'bg-emerald-500 text-white',
        dot: 'bg-emerald-500',
        ring: 'ring-emerald-500/20',
    },
    degraded: {
        label: 'Partial outage',
        pill: 'bg-amber-500 text-white',
        dot: 'bg-amber-500',
        ring: 'ring-amber-500/20',
    },
    unknown: {
        label: 'Checking…',
        pill: 'bg-slate-400 text-white',
        dot: 'bg-slate-400',
        ring: 'ring-slate-400/20',
    },
}

const COMPONENTS = [
    { key: 'db', label: 'Database' },
    { key: 'session', label: 'Session store' },
]

function checkTone(value) {
    if (value === 'ok') return { label: 'Operational', color: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' }
    if (typeof value === 'string' && value.startsWith('error')) return { label: value.replace(/^error:\s*/, 'Error: '), color: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500' }
    return { label: 'Unknown', color: 'text-slate-500 dark:text-slate-400', dot: 'bg-slate-400' }
}

export function StatusPage() {
    const [state, setState] = useState(() =>
        MOCK_MODE
            ? { status: 'ready', checks: { db: 'ok', session: 'ok' }, lastCheckedAt: new Date() }
            : { status: 'unknown', checks: {}, lastCheckedAt: null }
    )
    const [loading, setLoading] = useState(!MOCK_MODE)
    const mountedRef = useRef(true)

    const fetchOnce = useCallback(async () => {
        if (MOCK_MODE) {
            // Stable mock — makes dev/demo screenshots look good.
            setState({ status: 'ready', checks: { db: 'ok', session: 'ok' }, lastCheckedAt: new Date() })
            setLoading(false)
            return
        }
        setLoading(true)
        try {
            const res = await fetch('/api/health/ready', { credentials: 'omit' })
            const body = await res.json().catch(() => ({}))
            if (!mountedRef.current) return
            if (res.ok && body?.status === 'ready') {
                setState({ status: 'ready', checks: body.checks || {}, lastCheckedAt: new Date() })
            } else if (res.status === 503 && body?.status === 'degraded') {
                setState({ status: 'degraded', checks: body.checks || {}, lastCheckedAt: new Date() })
            } else {
                setState({ status: 'unknown', checks: {}, lastCheckedAt: new Date() })
            }
        } catch {
            if (!mountedRef.current) return
            setState(prev => ({ status: 'unknown', checks: {}, lastCheckedAt: prev.lastCheckedAt }))
        } finally {
            if (mountedRef.current) setLoading(false)
        }
    }, [])

    useEffect(() => {
        mountedRef.current = true
        // Defer the first fetch one microtask so the effect doesn't trigger
        // a synchronous setState (keeps react-hooks/set-state-in-effect happy
        // while preserving fire-on-mount behaviour).
        queueMicrotask(() => { if (mountedRef.current) fetchOnce() })
        const id = setInterval(() => { if (!document.hidden) fetchOnce() }, POLL_INTERVAL_MS)
        return () => { mountedRef.current = false; clearInterval(id) }
    }, [fetchOnce])

    const meta = STATUS_META[state.status] || STATUS_META.unknown
    const relative = useRelativeTime(state.lastCheckedAt)

    return (
        <main className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased">
            <div className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
                <header className="mb-10">
                    <p className="text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">System status</p>
                    <h1 className="text-2xl sm:text-3xl font-semibold">GitHub Repo Manager</h1>
                </header>

                <section
                    aria-live="polite"
                    className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-6 sm:p-8 ring-1 ${meta.ring}`}
                >
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                            <span className={`inline-block w-3 h-3 rounded-full ${meta.dot}`} aria-hidden="true" />
                            <span
                                data-testid="status-pill"
                                className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${meta.pill}`}
                            >
                                {meta.label}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={fetchOnce}
                            disabled={loading}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 disabled:cursor-wait"
                            aria-label="Refresh status"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M21 12a9 9 0 1 1-3-6.7" />
                                <path d="M21 3v6h-6" />
                            </svg>
                            {loading ? 'Checking…' : 'Refresh'}
                        </button>
                    </div>
                    <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                        {state.lastCheckedAt ? <>Updated {relative}</> : 'Waiting for first check…'}
                    </p>
                </section>

                <section className="mt-8">
                    <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">Components</h2>
                    <ul className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800 overflow-hidden">
                        {COMPONENTS.map(({ key, label }) => {
                            const raw = state.checks?.[key]
                            const tone = checkTone(state.status === 'unknown' ? undefined : raw)
                            return (
                                <li key={key} className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-900">
                                    <div className="flex items-center gap-3">
                                        <span className={`inline-block w-2 h-2 rounded-full ${tone.dot}`} aria-hidden="true" />
                                        <span className="text-sm">{label}</span>
                                    </div>
                                    <span data-testid={`check-${key}`} className={`text-xs font-medium ${tone.color}`}>{tone.label}</span>
                                </li>
                            )
                        })}
                    </ul>
                </section>

                <footer className="mt-10 text-xs text-slate-500 dark:text-slate-400 space-y-2">
                    <p className="font-medium text-slate-600 dark:text-slate-300">Legend</p>
                    <ul className="space-y-1">
                        <li><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2" />Operational — the dependency responded within budget.</li>
                        <li><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-2" />Partial outage — at least one dependency is degraded; some features may be unavailable.</li>
                        <li><span className="inline-block w-2 h-2 rounded-full bg-slate-400 mr-2" />Checking / Unknown — the status page could not reach the server.</li>
                    </ul>
                    <p className="pt-4">
                        <a href="/" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">Return to app</a>
                    </p>
                </footer>
            </div>
        </main>
    )
}

export default StatusPage
