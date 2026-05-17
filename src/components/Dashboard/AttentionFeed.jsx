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
import { fetchAttentionNarrative } from '../../api/attentionNarrative'
import { AIQuotaExceededError } from '../../api/aiFetch'
import { useAIStatus } from '../../hooks/useAIStatus'
import { useAIQuotaState } from '../../hooks/useAIQuotaState'
import { useAIUsage } from '../../hooks/useAIUsage'
import { formatRelativeTime } from '../../utils/format'
import { Spinner } from '../ui/Spinner'
import { AIQuotaMeter } from '../ui/AIQuotaMeter'
import { AIQuotaExhaustedCard } from '../ui/AIQuotaExhaustedCard'

const SEVERITY_RING = {
    high: 'ring-red-200 dark:ring-red-900/40 bg-red-50/50 dark:bg-red-950/20',
    medium: 'ring-amber-200 dark:ring-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20',
    low: 'ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900',
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
    const { aiQueries, tier } = useAIUsage()

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
            className={`overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ${className}`.trim()}
        >
            <div>
                <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-200/60 dark:border-slate-800">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            <Sparkles className="w-3 h-3" aria-hidden="true" />
                            Attention feed
                        </div>
                        <h3 id="attention-feed-title" className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 ds-font-display">
                            Repos that need your eyes
                        </h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {aiQueries && (
                            <AIQuotaMeter
                                current={aiQueries.current}
                                limit={aiQueries.limit}
                                tier={tier ?? 'free'}
                                resetAt={quota?.resetAt ?? null}
                            />
                        )}
                        <button
                            type="button"
                            onClick={() => setRefreshTick((t) => t + 1)}
                            disabled={loading}
                            aria-label="Refresh attention feed"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                        </button>
                    </div>
                </header>

                {loading && items.length === 0 ? (
                    <div className="px-5 py-8 flex justify-center">
                        <Spinner size="lg" tone="primary" label="Loading attention feed" />
                    </div>
                ) : (
                    <>
                        {quota && configured && keyOk && (
                            <AIQuotaExhaustedCard
                                feature={quota.feature}
                                used={quota.used}
                                limit={quota.limit}
                                resetAt={quota.resetAt}
                                upgradeTo={quota.upgradeTo}
                                currentTier={tier ?? 'free'}
                            />
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

function AttentionRow({ item, onClick, narrative = null }) {
    const Icon = KIND_ICON[item.kind] ?? Sparkles
    const ringClass = SEVERITY_RING[item.severity] ?? SEVERITY_RING.low
    const badgeClass = SEVERITY_BADGE[item.severity] ?? SEVERITY_BADGE.low
    const accentClass = KIND_ACCENT[item.kind] ?? 'text-indigo-500'
    const ago = formatRelativeTime(item.since)

    return (
        <li>
            <button
                type="button"
                onClick={onClick}
                className={`group flex w-full items-start gap-3 px-4 py-2.5 text-left ring-1 ring-inset transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 ${ringClass}`}
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
