import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { clsx } from 'clsx'
import { Sparkles, RefreshCw, X, AlertTriangle } from 'lucide-react'
import { fetchWithRetry } from '../../utils/api'
import { MOCK_MODE } from '../../config'
import { friendlyAiError } from '../../utils/aiErrorFriendly'
import { Skeleton } from '../ui/Skeleton'

function bulletHref(link) {
    if (!link || !link.repo || !link.number) return null
    const path = link.type === 'issue' ? 'issues' : 'pull'
    return `https://github.com/${link.repo}/${path}/${link.number}`
}

function UrgencyGauge({ score }) {
    const clamped = Math.max(0, Math.min(1, Number(score) || 0))
    const angle = -180 + 180 * clamped
    const rad = (angle * Math.PI) / 180
    const cx = 28, cy = 28, r = 22
    const x = cx + r * Math.cos(rad)
    const y = cy + r * Math.sin(rad)
    const largeArc = clamped > 0.5 ? 1 : 0
    const start = `${cx - r},${cy}`
    const path = clamped === 0 ? '' : `M${start} A${r},${r} 0 ${largeArc} 1 ${x},${y}`
    const stroke = clamped > 0.7 ? '#f43f5e' : clamped > 0.3 ? '#f59e0b' : '#6366f1'
    return (
        <svg width="56" height="34" viewBox="0 0 56 34" aria-label={`urgency ${(clamped * 100).toFixed(0)}%`}>
            <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" strokeLinecap="round" />
            {path && <path d={path} fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />}
            <text x="28" y="30" textAnchor="middle" className="text-[10px] font-semibold fill-slate-600 dark:fill-slate-300">
                {(clamped * 100).toFixed(0)}
            </text>
        </svg>
    )
}

function timeAgo(isoString) {
    if (!isoString) return null
    const diffMs = Date.now() - new Date(isoString).getTime()
    const mins = Math.round(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    return `${Math.round(mins / 60)} hr ago`
}

export function AISummaryCard({ meta: metaProp } = {}) {
    const [state, setState] = useState({ status: 'loading', data: null, error: null })
    const [dismissed, setDismissed] = useState(false)

    const fetchSummary = useCallback(async () => {
        if (MOCK_MODE) { setState({ status: 'hidden', data: null, error: null }); return }
        setState(s => ({ ...s, status: 'loading', error: null }))
        try {
            // fetchWithRetry handles CSRF injection, retry on transient 5xx,
            // and session-expiry detection. We need the raw Response so we
            // can branch on status (401/403/404 → silently hide; other
            // non-2xx → friendly error). It throws ApiError for those, so
            // we catch and inspect.
            const res = await fetchWithRetry('/api/v1/work-board/ai-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            })
            const json = await res.json().catch(() => ({}))
            setState({ status: 'ready', data: json.data, error: null })
        } catch (e) {
            const status = e?.status ?? null
            // 401/403/404 → silently hide: the endpoint isn't reachable for
            // this user (no BYOK, no session, or route not mounted). A noisy
            // error banner helps no one here.
            if (status === 401 || status === 403 || status === 404) {
                setState({ status: 'hidden', data: null, error: null })
                return
            }
            // Network / 5xx after retries → render the error banner.
            setState({
                status: 'error',
                data: null,
                error: status
                    ? friendlyAiError({ status, body: e?.data || {} })
                    : { headline: 'Could not reach the server.', detail: e?.message || 'fetch failed' },
            })
        }
    }, [])

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchSummary() }, [fetchSummary])

    // Listen for the command-palette-originated regenerate event.
    useEffect(() => {
        const h = () => fetchSummary()
        window.addEventListener('workboard:ai-regenerate-internal', h)
        return () => window.removeEventListener('workboard:ai-regenerate-internal', h)
    }, [fetchSummary])

    if (dismissed) return null
    if (state.status === 'hidden') return null
    if (state.status === 'loading' && !state.data) {
        return (
            <div className="rounded-3xl border border-slate-200/60 dark:border-slate-700/50 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-5" role="status" aria-live="polite">
                <Skeleton className="h-5 w-1/2 mb-3" />
                <div className="space-y-2">
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-3 w-3/5" />
                </div>
            </div>
        )
    }
    if (state.status === 'error') {
        // Tolerate legacy string errors (e.g. tests, older callers) and the new
        // { headline, detail } shape produced by friendlyAiError.
        const err = typeof state.error === 'string'
            ? { headline: 'AI summary failed', detail: state.error }
            : (state.error || { headline: 'AI summary failed', detail: '' })
        return (
            <div
                role="alert"
                className="rounded-2xl border border-rose-200/60 dark:border-rose-900/40 bg-rose-50/60 dark:bg-rose-950/20 p-3 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-3"
            >
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                    <div className="font-medium">{err.headline}</div>
                    {err.detail && (
                        <div className="text-xs opacity-90 mt-0.5">{err.detail}</div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={fetchSummary}
                    className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-rose-700 dark:text-rose-300 bg-white/60 dark:bg-slate-900/40 hover:bg-white dark:hover:bg-slate-900 transition"
                >
                    Retry
                </button>
            </div>
        )
    }

    const { headline, bullets = [], urgencyScore = 0, provider: fetchedProvider, model: fetchedModel, generatedAt } = state.data || {}
    const provider = metaProp?.provider ?? fetchedProvider
    const model = metaProp?.model ?? fetchedModel
    const urgency = urgencyScore
    const isHigh = urgency > 0.8

    const glowAnimation = isHigh ? {
        boxShadow: [
            '0 0 0px rgba(244,63,94,0)',
            '0 0 24px rgba(244,63,94,0.18)',
            '0 0 0px rgba(244,63,94,0)',
        ],
    } : {}

    const severityLabel = urgency > 0.7 ? 'Critical' : urgency > 0.4 ? 'Elevated' : 'Nominal'
    const severityColor = urgency > 0.7 ? 'text-rose-400' : urgency > 0.4 ? 'text-amber-400' : 'text-indigo-400'

    const trendMatch = headline?.match(/([\w\s]+)\s+(up|down)\s+(\d+%)/i)
    const trendLine = trendMatch
        ? `${trendMatch[2] === 'up' ? '↑' : '↓'} ${trendMatch[1].trim()} ${trendMatch[2] === 'up' ? '+' : '-'}${trendMatch[3]} vs last week`
        : null

    return (
        <motion.div
            className={clsx(
                'relative rounded-3xl border border-slate-200/60 dark:border-slate-700/50',
                'bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-lg overflow-hidden ds-card-shimmer',
                'flex flex-col sm:flex-row gap-6 p-5',
            )}
            animate={glowAnimation}
            transition={isHigh ? { duration: 3, repeat: Infinity, ease: 'easeInOut' } : {}}
        >
            <div className="pointer-events-none absolute -top-16 left-1/4 w-96 h-36 rounded-full bg-gradient-to-r from-indigo-500/20 via-purple-500/15 to-transparent blur-3xl" />

            {/* Left column — gauge + controls */}
            <div className="relative flex flex-col items-center gap-2 min-w-[100px] sm:pl-2 sm:pr-4 sm:border-r sm:border-slate-200/50 sm:dark:border-slate-700/40">
                <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-500 dark:text-indigo-400 self-start sm:self-center">
                    <Sparkles className="w-3 h-3" aria-hidden="true" />
                    AI summary
                </div>
                <UrgencyGauge score={urgency} />
                <span className={clsx('text-xs font-semibold uppercase tracking-widest', severityColor)}>
                    {severityLabel}
                </span>
                {(provider || model) && (
                    <span className="mt-1 px-2 py-0.5 text-[10px] rounded-full bg-slate-100 dark:bg-slate-700/80 text-slate-500 dark:text-slate-400">
                        {provider}{model ? ` · ${model}` : ''}
                    </span>
                )}
                <div className="flex gap-1 mt-1">
                    <button type="button" onClick={fetchSummary} disabled={state.status === 'loading'} aria-label="Regenerate summary" title="Regenerate" className="p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-500 dark:text-slate-400 transition disabled:opacity-50">
                        <motion.div animate={{ rotate: state.status === 'loading' ? 360 : 0 }} transition={{ duration: 0.6 }}>
                            <RefreshCw className="w-4 h-4" />
                        </motion.div>
                    </button>
                    <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss" title="Dismiss" className="p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-500 dark:text-slate-400 transition">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Right column — content */}
            <div className="relative flex-1 flex flex-col gap-2 min-w-0">
                <h3 className="text-xl md:text-2xl font-bold leading-tight ds-font-display ds-gradient-text">
                    {headline}
                </h3>
                {trendLine && (
                    <p className="text-[12px] text-slate-400">{trendLine}</p>
                )}
                <AnimatePresence>
                    <motion.ul className="mt-2 space-y-2">
                        {bullets.map((b, i) => {
                            const href = bulletHref(b.link)
                            const dotColor = b.severity === 'high' ? 'bg-rose-500' :
                                b.severity === 'medium' ? 'bg-amber-500' : 'bg-slate-400'
                            const content = (
                                <span className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                                    <span className={clsx('mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0', dotColor)} aria-hidden="true" />
                                    <span className="min-w-0">{b.text}</span>
                                </span>
                            )
                            return (
                                <motion.li
                                    key={`${i}-${b.text}`}
                                    initial={{ opacity: 0, x: -4 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.04 }}
                                >
                                    {href ? (
                                        <a href={href} target="_blank" rel="noopener noreferrer" className="block hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg px-1 -mx-1 transition-colors">
                                            {content}
                                        </a>
                                    ) : (
                                        <div className="px-1 -mx-1">{content}</div>
                                    )}
                                </motion.li>
                            )
                        })}
                    </motion.ul>
                </AnimatePresence>
                {generatedAt && (
                    <p className="mt-auto pt-2 text-[11px] text-slate-500 text-right">
                        Generated {timeAgo(generatedAt)}
                    </p>
                )}
            </div>
        </motion.div>
    )
}
