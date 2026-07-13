import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { clsx } from 'clsx'
import { Sparkles, RefreshCw, X } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { Badge } from '../ui/Badge'
import { fetchWithRetry } from '../../utils/api'
import { MOCK_MODE } from '../../config'
import { AIErrorState } from '../ui/AIErrorState'
import { Skeleton } from '../ui/Skeleton'
import { onAppEvent, APP_EVENTS } from '../../utils/appEvents'
import { formatRelativeTime } from '../../utils/format'

function bulletHref(link) {
    if (!link || !link.repo || !link.number) return null
    const path = link.type === 'issue' ? 'issues' : 'pull'
    return `https://github.com/${link.repo}/${path}/${link.number}`
}

// Single source of truth for urgency severity: one clamped threshold set
// mapping to both the display label and the theme-aware design token
// (design-system.css) shared by the gauge stroke AND the severity label —
// the pair renders from the same token so they can never drift apart.
// The nominal state uses the chart-series-1 (brand/indigo) token rather
// than the grey neutral token, keeping the calm state visually branded.
function urgencySeverity(score) {
    const clamped = Math.max(0, Math.min(1, Number(score) || 0))
    if (clamped > 0.7) return { clamped, label: 'Critical', token: 'var(--ds-status-danger)' }
    if (clamped > 0.3) return { clamped, label: 'Elevated', token: 'var(--ds-status-warning)' }
    return { clamped, label: 'Nominal', token: 'var(--ds-chart-series-1)' }
}

function UrgencyGauge({ score }) {
    const { clamped, token: stroke } = urgencySeverity(score)
    const angle = -180 + 180 * clamped
    const rad = (angle * Math.PI) / 180
    const cx = 28, cy = 28, r = 22
    const x = cx + r * Math.cos(rad)
    const y = cy + r * Math.sin(rad)
    const largeArc = clamped > 0.5 ? 1 : 0
    const start = `${cx - r},${cy}`
    const path = clamped === 0 ? '' : `M${start} A${r},${r} 0 ${largeArc} 1 ${x},${y}`
    return (
        <svg width="56" height="34" viewBox="0 0 56 34" aria-label={`urgency ${(clamped * 100).toFixed(0)}%`}>
            <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" strokeLinecap="round" />
            {path && <path d={path} fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />}
            <text x="28" y="30" textAnchor="middle" className="ds-text-micro font-semibold fill-slate-600 dark:fill-slate-300">
                {(clamped * 100).toFixed(0)}
            </text>
        </svg>
    )
}

export function AISummaryCard({ meta: metaProp } = {}) {
    const [state, setState] = useState({ status: 'loading', data: null, error: null })
    const [dismissed, setDismissed] = useState(false)

    const fetchSummary = useCallback(async () => {
        // Demo mode: surface the card with an explained-empty placeholder
        // instead of silently hiding the feature. Users should see what the
        // production card looks like even when no AI provider is wired up.
        if (MOCK_MODE) { setState({ status: 'demo', data: null, error: null }); return }
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
                error: e,
            })
        }
    }, [])

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchSummary() }, [fetchSummary])

    // Listen for the command-palette-originated regenerate event.
    useEffect(() => {
        const h = () => fetchSummary()
        return onAppEvent(APP_EVENTS.WORKBOARD_AI_REGENERATE_INTERNAL, h)
    }, [fetchSummary])

    if (dismissed) return null
    if (state.status === 'hidden') return null
    if (state.status === 'demo') {
        return (
            <div
                role="status"
                data-testid="ai-summary-demo"
                className="rounded-2xl border border-dashed border-amber-300/70 dark:border-amber-700/50 p-4 bg-amber-50/60 dark:bg-amber-950/20"
            >
                <div className="flex items-center gap-2 mb-1.5">
                    <Sparkles className="w-4 h-4 text-amber-500" aria-hidden="true" />
                    <span className="font-medium text-sm text-slate-800 dark:text-slate-200">AI Work Summary</span>
                    <span className="ds-text-micro uppercase tracking-wide text-amber-700 dark:text-amber-300">demo</span>
                    <button
                        type="button"
                        onClick={() => setDismissed(true)}
                        aria-label="Dismiss"
                        title="Dismiss"
                        className="ml-auto p-1 rounded-lg hover:bg-amber-100/60 dark:hover:bg-amber-900/30 text-slate-500 dark:text-slate-400 transition"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    In production, this card surfaces a daily AI summary of stale PRs,
                    stuck issues, and review hotspots across your tracked repos.
                </p>
            </div>
        )
    }
    if (state.status === 'loading' && !state.data) {
        return (
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-5" role="status" aria-live="polite">
                <Skeleton className="h-5 w-1/2 mb-3" />
                <div className="space-y-2">
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-3 w-3/5" />
                </div>
            </div>
        )
    }
    if (state.status === 'error') {
        return (
            <AIErrorState
                error={state.error}
                onRetry={fetchSummary}
                context="AI summary"
                variant="card"
                className="rounded-2xl"
            />
        )
    }

    const { headline, bullets = [], urgencyScore = 0, provider: fetchedProvider, model: fetchedModel, generatedAt } = state.data || {}
    const provider = metaProp?.provider ?? fetchedProvider
    const model = metaProp?.model ?? fetchedModel
    const urgency = urgencyScore
    const isHigh = urgency > 0.8

    // Label + color come from the same mapping the gauge stroke uses, so the
    // text, its color, and the arc always agree on severity and hue.
    const severity = urgencySeverity(urgency)

    const trendMatch = headline?.match(/([\w\s]+)\s+(up|down)\s+(\d+%)/i)
    const trendLine = trendMatch
        ? `${trendMatch[2] === 'up' ? '↑' : '↓'} ${trendMatch[1].trim()} ${trendMatch[2] === 'up' ? '+' : '-'}${trendMatch[3]} vs last week`
        : null

    return (
        <motion.div
            className={clsx(
                'relative rounded-3xl border border-slate-200 dark:border-slate-700/60',
                'bg-white dark:bg-slate-900 shadow-sm overflow-hidden',
                'flex flex-col sm:flex-row gap-6 p-5',
                isHigh && 'ring-2 ring-rose-500/40 dark:ring-rose-400/40',
            )}
        >

            {/* Left column — gauge + controls */}
            <div className="relative flex flex-col items-center gap-2 min-w-[100px] sm:pl-2 sm:pr-4 sm:border-r sm:border-slate-200/50 sm:dark:border-slate-700/40">
                <div className="inline-flex items-center gap-1.5 ds-text-micro font-semibold uppercase tracking-[0.18em] text-indigo-500 dark:text-[color:var(--ds-accent-brand-dark)] self-start sm:self-center">
                    <Sparkles className="w-3 h-3" aria-hidden="true" />
                    AI summary
                </div>
                <UrgencyGauge score={urgency} />
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: severity.token }}>
                    {severity.label}
                </span>
                {(provider || model) && (
                    <Badge tone="neutral" size="xs" className="mt-1 font-normal">
                        {provider}{model ? ` · ${model}` : ''}
                    </Badge>
                )}
                <div className="flex gap-1 mt-1">
                    <Tooltip label="Regenerate">
                        <button
                            type="button"
                            onClick={fetchSummary}
                            disabled={state.status === 'loading'}
                            aria-label="Regenerate summary"
                            className="p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50 ds-focus-ring"
                        >
                            <motion.div animate={{ rotate: state.status === 'loading' ? 360 : 0 }} transition={{ duration: 0.6 }}>
                                <RefreshCw className="w-4 h-4" />
                            </motion.div>
                        </button>
                    </Tooltip>
                    <Tooltip label="Dismiss">
                        <button
                            type="button"
                            onClick={() => setDismissed(true)}
                            aria-label="Dismiss"
                            className="p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-500 dark:text-slate-400 transition-colors ds-focus-ring"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* Right column — content */}
            <div className="relative flex-1 flex flex-col gap-2 min-w-0">
                <h3 className="text-xl font-semibold leading-tight ds-font-display text-slate-900 dark:text-slate-50">
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
                    <p className="mt-auto pt-2 ds-text-meta text-slate-500 text-right">
                        Generated {formatRelativeTime(generatedAt)}
                    </p>
                )}
            </div>
        </motion.div>
    )
}
