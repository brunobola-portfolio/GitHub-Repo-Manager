import { useEffect, useState } from 'react'
import {
    Sparkles,
    AlertTriangle,
    Clock,
    Pin,
    Flame,
    ChevronRight,
    RefreshCw,
} from 'lucide-react'
import { fetchAttentionFeed } from '../../api/attentionFeed'
import { Spinner } from '../ui/Spinner'

const SEVERITY_RING = {
    high: 'ring-red-500/30 bg-gradient-to-br from-red-500/[0.06] via-rose-500/[0.04] to-transparent dark:from-red-500/[0.10] dark:via-rose-500/[0.06]',
    medium: 'ring-amber-500/30 bg-gradient-to-br from-amber-500/[0.06] via-orange-500/[0.04] to-transparent dark:from-amber-500/[0.10] dark:via-orange-500/[0.06]',
    low: 'ring-slate-200/70 dark:ring-slate-800 bg-white/70 dark:bg-slate-900/60',
}

const SEVERITY_BADGE = {
    high: 'bg-red-100 text-red-700 ring-red-200 dark:bg-red-900/40 dark:text-red-200 dark:ring-red-800',
    medium: 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800',
    low: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
}

const KIND_ICON = {
    failed_migration: AlertTriangle,
    stale_pinned: Pin,
    abandoned: Clock,
    hot: Flame,
}

const KIND_ACCENT = {
    failed_migration: 'text-red-500',
    stale_pinned: 'text-amber-500',
    abandoned: 'text-slate-400',
    hot: 'text-orange-500',
}

const KIND_LABEL = {
    failed_migration: 'Migration failed',
    stale_pinned: 'Pinned but quiet',
    abandoned: 'Abandoned',
    hot: 'Active today',
}

function relativeTime(iso) {
    if (!iso) return null
    const ms = Date.now() - new Date(iso).getTime()
    if (Number.isNaN(ms)) return null
    if (ms < 60_000) return 'just now'
    const m = Math.floor(ms / 60_000)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
}

/**
 * AttentionFeed — top-of-dashboard card listing the repos that need the
 * user's eyes today. Pure DB aggregation on the backend (failed migrations,
 * pinned-but-quiet, abandoned, hot) so it loads fast even when GitHub is
 * rate-limited.
 *
 * Each row is a tiny "why" + the repo it's about + a relative timestamp.
 * Click → navigates to the repo (consumer supplies onSelectRepo). The whole
 * card collapses gracefully when there's nothing to show.
 */
export function AttentionFeed({ onSelectRepo, limit = 5, className = '' }) {
    const [feed, setFeed] = useState({ items: [], counts: {}, total: 0 })
    const [loading, setLoading] = useState(true)
    const [refreshTick, setRefreshTick] = useState(0)

    /* eslint-disable react-hooks/set-state-in-effect -- mount + refresh-tick fetch */
    useEffect(() => {
        const ctrl = new AbortController()
        let cancelled = false
        setLoading(true)
        fetchAttentionFeed({ limit, signal: ctrl.signal }).then((data) => {
            if (cancelled) return
            // Defensive: the API normalises but never let a surprise from the
            // wire explode the dashboard. Always settle into a known shape.
            setFeed({
                items: Array.isArray(data?.items) ? data.items : [],
                counts: data?.counts ?? {},
                total: data?.total ?? 0,
            })
            setLoading(false)
        })
        return () => {
            cancelled = true
            ctrl.abort()
        }
    }, [limit, refreshTick])
    /* eslint-enable react-hooks/set-state-in-effect */

    const items = feed?.items ?? []
    if (!loading && items.length === 0) return null

    return (
        <section
            aria-labelledby="attention-feed-title"
            className={`rounded-2xl p-[1px] bg-gradient-to-br from-indigo-500/30 via-purple-500/20 to-pink-500/10 dark:from-indigo-500/40 dark:via-purple-500/30 dark:to-pink-500/20 ${className}`.trim()}
        >
            <div className="rounded-2xl bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl">
                <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-200/60 dark:border-slate-800">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300">
                            <Sparkles className="w-3 h-3" aria-hidden="true" />
                            Attention feed
                        </div>
                        <h3 id="attention-feed-title" className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100 ds-font-display">
                            Repos that need your eyes
                        </h3>
                    </div>
                    <button
                        type="button"
                        onClick={() => setRefreshTick((t) => t + 1)}
                        disabled={loading}
                        aria-label="Refresh attention feed"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    </button>
                </header>

                {loading && items.length === 0 ? (
                    <div className="px-5 py-8 flex justify-center">
                        <Spinner size="lg" tone="primary" label="Loading attention feed" />
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-200/60 dark:divide-slate-800">
                        {items.map((item) => (
                            <AttentionRow
                                key={item.id}
                                item={item}
                                onClick={() => onSelectRepo?.(item.repoFullName, item)}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </section>
    )
}

function AttentionRow({ item, onClick }) {
    const Icon = KIND_ICON[item.kind] ?? Sparkles
    const ringClass = SEVERITY_RING[item.severity] ?? SEVERITY_RING.low
    const badgeClass = SEVERITY_BADGE[item.severity] ?? SEVERITY_BADGE.low
    const accentClass = KIND_ACCENT[item.kind] ?? 'text-indigo-500'
    const ago = relativeTime(item.since)

    return (
        <li>
            <button
                type="button"
                onClick={onClick}
                className={`group flex w-full items-start gap-3 px-5 py-3 text-left ring-1 ring-inset transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 ${ringClass}`}
            >
                <span className={`mt-0.5 shrink-0 ${accentClass}`}>
                    <Icon className="w-4 h-4" aria-hidden="true" />
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {item.repoFullName}
                        </span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${badgeClass}`}>
                            {KIND_LABEL[item.kind] ?? item.kind}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                        {item.title}
                    </p>
                    {item.hint && (
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                            {item.hint}
                        </p>
                    )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                    {ago && <span>{ago}</span>}
                    <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 transition-colors" aria-hidden="true" />
                </div>
            </button>
        </li>
    )
}
