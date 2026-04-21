import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, RefreshCw, X, AlertTriangle } from 'lucide-react'

const SEVERITY_DOTS = {
    high: 'bg-rose-500',
    medium: 'bg-amber-500',
    info: 'bg-slate-400',
}

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

export function AISummaryCard() {
    const [state, setState] = useState({ status: 'loading', data: null, error: null })
    const [dismissed, setDismissed] = useState(false)

    const fetchSummary = useCallback(async () => {
        setState(s => ({ ...s, status: 'loading', error: null }))
        try {
            const res = await fetch('/api/v1/work-board/ai-summary', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) {
                if (res.status === 404 && json.code === 'ai_not_configured') {
                    setState({ status: 'hidden', data: null, error: null })
                    return
                }
                setState({ status: 'error', data: null, error: json.error || `status ${res.status}` })
                return
            }
            setState({ status: 'ready', data: json.data, error: null })
        } catch (e) {
            setState({ status: 'error', data: null, error: e.message || 'fetch failed' })
        }
    }, [])

    useEffect(() => { fetchSummary() }, [fetchSummary])

    if (dismissed) return null
    if (state.status === 'hidden') return null
    if (state.status === 'loading' && !state.data) {
        return (
            <div className="rounded-3xl border border-slate-200/60 dark:border-slate-700/50 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-5 animate-pulse" role="status" aria-live="polite">
                <div className="h-5 w-1/2 bg-slate-200 dark:bg-slate-800 rounded mb-3" />
                <div className="space-y-2">
                    <div className="h-3 w-4/5 bg-slate-200 dark:bg-slate-800 rounded" />
                    <div className="h-3 w-3/5 bg-slate-200 dark:bg-slate-800 rounded" />
                </div>
            </div>
        )
    }
    if (state.status === 'error') {
        return (
            <div className="rounded-2xl border border-rose-200/60 dark:border-rose-900/40 bg-rose-50/60 dark:bg-rose-950/20 p-3 text-sm text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                <span>AI summary failed. {state.error}</span>
                <button type="button" onClick={fetchSummary} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-rose-700 dark:text-rose-300 bg-white/60 dark:bg-slate-900/40 hover:bg-white dark:hover:bg-slate-900 transition">
                    Retry
                </button>
            </div>
        )
    }

    const { headline, bullets = [], urgencyScore = 0, provider, model } = state.data || {}

    return (
        <div className="relative rounded-3xl border border-slate-200/60 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-lg overflow-hidden ds-card-shimmer">
            <div className="pointer-events-none absolute -top-16 left-1/4 w-96 h-36 rounded-full bg-gradient-to-r from-indigo-500/20 via-purple-500/15 to-transparent blur-3xl" />
            <div className="relative p-5 flex flex-col md:flex-row gap-5">
                <div className="flex-1 min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-500 dark:text-indigo-400 mb-2">
                        <Sparkles className="w-3 h-3" aria-hidden="true" />
                        AI summary
                    </div>
                    <h3 className="text-xl md:text-2xl font-bold leading-tight ds-font-display ds-gradient-text">
                        {headline}
                    </h3>
                    <AnimatePresence>
                        <motion.ul className="mt-4 space-y-2">
                            {bullets.map((b, i) => {
                                const href = bulletHref(b.link)
                                const content = (
                                    <span className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                                        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOTS[b.severity] || SEVERITY_DOTS.info}`} aria-hidden="true" />
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
                    {(provider || model) && (
                        <div className="mt-3 text-[10px] text-slate-400 dark:text-slate-500">
                            {provider}{model ? ` · ${model}` : ''}
                        </div>
                    )}
                </div>

                <div className="flex md:flex-col items-center justify-between gap-3 md:gap-2 md:pl-4 md:border-l md:border-slate-200/50 md:dark:border-slate-700/40">
                    <UrgencyGauge score={urgencyScore} />
                    <div className="flex md:flex-col gap-1">
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
            </div>
        </div>
    )
}
