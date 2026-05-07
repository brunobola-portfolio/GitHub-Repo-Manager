import { useEffect, useState } from 'react'
import {
    Sparkles,
    AlertTriangle,
    Clock,
    Pin,
    Flame,
    ChevronRight,
    RefreshCw,
    Gauge,
} from 'lucide-react'
import { fetchAttentionFeed } from '../../api/attentionFeed'
import { fetchAttentionNarrative } from '../../api/attentionNarrative'
import { AIQuotaExceededError } from '../../api/aiFetch'
import { useAIStatus } from '../../hooks/useAIStatus'
import { useAIQuotaState } from '../../hooks/useAIQuotaState'
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
// Number of top items that get an AI narrative (when AI is configured + healthy).
// Each request hits the cache after the first call, so repeated dashboard loads
// don't re-bill — but the initial cold render of three items costs ~3× tokens
// vs a single narrative. Tunable here if cost pressure changes.
const NARRATIVE_TOP_N = 3

export function AttentionFeed({ onSelectRepo, limit = 5, className = '' }) {
    const [feed, setFeed] = useState({ items: [], counts: {}, total: 0 })
    const [loading, setLoading] = useState(true)
    const [refreshTick, setRefreshTick] = useState(0)
    const [narratives, setNarratives] = useState({})
    const { configured, keyOk } = useAIStatus()
    // Global quota gate (set when ANY AI call returns 429+QUOTA_EXCEEDED).
    // We render a single, polished inline notice instead of letting parallel
    // narrative fan-outs spam the devtools console with 429s.
    const quota = useAIQuotaState()

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
    // Stable composite key over the top-N items so the effect re-runs only
    // when the meaningful identity of the slice changes (not on every
    // refresh of the parent).
    const topItems = items.slice(0, NARRATIVE_TOP_N)
    const topKeys = topItems.map((it) => `${it.id}|${it.repoFullName}|${it.kind}|${it.since ?? ''}`)
    const topKeysJoined = topKeys.join('||')

    /* eslint-disable react-hooks/set-state-in-effect -- top items change drives AI narrative fan-out */
    useEffect(() => {
        if (topItems.length === 0 || !configured || !keyOk) {
            setNarratives({})
            return undefined
        }
        // If the quota gate is already closed when we get here, do not
        // even attempt to fan out — the inline notice above the list will
        // explain why narratives are absent.
        if (quota) {
            const settled = {}
            for (const it of topItems) settled[it.id] = { text: null, loading: false }
            setNarratives(settled)
            return undefined
        }

        const ctrl = new AbortController()
        let cancelled = false
        // Mark all loading up-front so the rows render their shimmer
        // simultaneously instead of cascading as each request resolves.
        const loadingMap = {}
        for (const it of topItems) loadingMap[it.id] = { text: null, loading: true }
        setNarratives(loadingMap)

        // Sequential fan-out: as soon as one request reveals an exhausted
        // quota, the rest are short-circuited. The aiFetch quota gate
        // already pre-empts before the network, so the savings are mostly
        // about the FIRST hit in a session — but the loop is also where we
        // decide to settle the remaining rows to "no narrative" without
        // showing an indefinite shimmer.
        ;(async () => {
            const next = {}
            let bailed = false
            for (const it of topItems) {
                if (cancelled) return
                if (bailed) {
                    next[it.id] = { text: null, loading: false }
                    continue
                }
                try {
                    const data = await fetchAttentionNarrative({
                        repo: it.repoFullName,
                        kind: it.kind,
                        signalPayload: {
                            title: it.title,
                            hint: it.hint,
                            since: it.since,
                            severity: it.severity,
                        },
                        abortSignal: ctrl.signal,
                    })
                    next[it.id] = { text: data?.narrative ?? null, loading: false }
                } catch (err) {
                    if (err instanceof AIQuotaExceededError) {
                        bailed = true
                    }
                    next[it.id] = { text: null, loading: false }
                }
            }
            if (!cancelled) setNarratives(next)
        })()

        return () => {
            cancelled = true
            ctrl.abort()
        }
    }, [topKeysJoined, configured, keyOk, quota]) // eslint-disable-line react-hooks/exhaustive-deps -- topKeysJoined captures meaningful identity

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
                    <>
                        {quota && configured && keyOk && (
                            <QuotaNotice quota={quota} />
                        )}
                        <ul className="divide-y divide-slate-200/60 dark:divide-slate-800">
                            {items.map((item, idx) => (
                                <AttentionRow
                                    key={item.id}
                                    item={item}
                                    narrative={idx < NARRATIVE_TOP_N ? (narratives[item.id] ?? null) : null}
                                    onClick={() => onSelectRepo?.(item.repoFullName, item)}
                                />
                            ))}
                        </ul>
                    </>
                )}
            </div>
        </section>
    )
}

// Format the server's `resetAt` ISO into a user-friendly relative string.
// "in 3 days" reads better than "2026-06-01T00:00:00Z" in a dashboard pill.
function formatReset(iso) {
    if (!iso) return null
    const ms = new Date(iso).getTime() - Date.now()
    if (Number.isNaN(ms) || ms <= 0) return null
    const m = Math.round(ms / 60_000)
    if (m < 60) return `in ${m} min`
    const h = Math.round(m / 60)
    if (h < 24) return `in ${h}h`
    const d = Math.round(h / 24)
    return `in ${d} day${d === 1 ? '' : 's'}`
}

function QuotaNotice({ quota }) {
    const reset = formatReset(quota?.resetAt)
    return (
        <div className="px-5 py-3 border-b border-amber-200/60 dark:border-amber-800/40 bg-gradient-to-r from-amber-50 via-amber-50/60 to-transparent dark:from-amber-900/20 dark:via-amber-900/10">
            <div className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-200">
                    <Gauge className="w-3.5 h-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-amber-800 dark:text-amber-200 leading-tight">
                        AI insights paused — monthly quota reached
                    </p>
                    <p className="mt-0.5 text-[11px] text-amber-700/90 dark:text-amber-300/90">
                        {quota.limit != null && quota.used != null
                            ? `${quota.used} / ${quota.limit} requests used`
                            : 'Your plan limit was reached'}
                        {reset ? ` · resets ${reset}` : ''}
                        {quota.upgradeTo ? ` · upgrade to ${quota.upgradeTo} for more` : ''}
                        . The repo signals below are still live — only the AI narrative is muted.
                    </p>
                </div>
            </div>
        </div>
    )
}

function AttentionRow({ item, onClick, narrative = null }) {
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
                    {narrative?.loading && (
                        <p className="mt-1.5 h-3 w-2/3 rounded bg-indigo-100/60 dark:bg-indigo-900/30 animate-pulse" aria-hidden="true" />
                    )}
                    {!narrative?.loading && narrative?.text && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] italic text-indigo-700 dark:text-indigo-300">
                            <Sparkles className="w-3 h-3 shrink-0 mt-[2px]" aria-hidden="true" />
                            <span>{narrative.text}</span>
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
