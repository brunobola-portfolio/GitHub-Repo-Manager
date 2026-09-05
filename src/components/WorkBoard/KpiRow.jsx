import { motion } from 'framer-motion'
import { clsx } from 'clsx'
import { GitPullRequest, AlertTriangle, CircleDot, Wrench } from 'lucide-react'
import { ageLabel, dayLabel } from './shared/formatters'
import { Skeleton } from '../ui/Skeleton'
import { CountUp } from '../ui/CountUp'
import { DURATION, EASE } from '../ui/motion'

function computeDelta(history) {
    if (!Array.isArray(history) || history.length < 2) return null
    const first = history[0]
    const last = history[history.length - 1]
    if (first === 0) return null
    return Math.round(((last - first) / first) * 100)
}

function Sparkline({ history, accent }) {
    // Guard against malformed snapshots (missing/null metric fields). A single
    // non-numeric value turns Math.min/max into NaN and corrupts every point,
    // so drop non-finite entries before deciding whether to draw at all.
    const series = Array.isArray(history)
        ? history.filter(v => typeof v === 'number' && Number.isFinite(v))
        : []
    if (series.length < 3) return null
    const W = 40, H = 16
    const min = Math.min(...series)
    const max = Math.max(...series)
    const range = max - min || 1
    const points = series.map((v, i) => {
        const x = (i / (series.length - 1)) * W
        const y = H - ((v - min) / range) * (H - 2) - 1
        return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')

    return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible" aria-hidden="true">
            <motion.polyline
                points={points}
                fill="none"
                stroke={accent}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: DURATION.ambient, ease: EASE.emphasized }}
            />
        </svg>
    )
}

function DeltaBadge({ pct }) {
    if (pct === null) return null
    const flat = Math.abs(pct) < 5
    const up = pct > 0
    const label = flat ? '—' : (up ? `+${pct}%` : `${pct}%`)
    const color = flat ? 'text-slate-500 dark:text-slate-400' : up ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'
    return (
        <motion.span
            className={clsx('ds-text-micro font-medium tabular-nums', color)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: DURATION.slow }}
        >
            {label}
        </motion.span>
    )
}

// Two accents, not five.
//
// These tiles used to be purple / amber / emerald / indigo — four hues chosen
// for variety, next to a lime mark that matched none of them. Decoration by
// hue is what made the dashboard read as a swatch board, and it also spent the
// status vocabulary on tiles that carry no status: an emerald dot on "My
// Issues" says passing, which is not what an open issue is.
//
// `attention` survives because it means something (stale work, the same amber
// as ds-risk-medium). Everything else is brand. Legacy names still resolve so
// callers can be migrated without a flag day.
const BRAND_ACCENT = {
    dot: 'bg-brand-500',
    text: 'text-brand-600 dark:text-brand-300',
    sparkColor: 'var(--ds-chart-series-1)',
}

const KPI_ACCENTS = {
    brand: BRAND_ACCENT,
    attention: {
        dot: 'bg-amber-500',
        text: 'text-amber-700 dark:text-amber-300',
        sparkColor: 'var(--ds-chart-series-3)',
    },
    purple: BRAND_ACCENT,
    emerald: BRAND_ACCENT,
    indigo: BRAND_ACCENT,
    sky: BRAND_ACCENT,
    get amber() { return KPI_ACCENTS.attention },
}

function KpiTile({ icon: Icon, label, value, hint, loading, errored, accent = 'brand', onClick, active, history }) {
    const a = KPI_ACCENTS[accent] || KPI_ACCENTS.brand
    const delta = computeDelta(history)
    // When the underlying fetch failed and we never received data, stay honest:
    // a bare "0 / all caught up" would claim the user is clear when we simply
    // don't know. Show a neutral dash + "couldn't load" instead.
    const showError = errored && !loading

    return (
        <button
            type="button"
            onClick={onClick}
            className={`
                group relative text-left p-5 rounded-2xl border
                transition-all duration-200 ds-hover-lift
                ${active
                    ? 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600'
                }
             ds-focus-ring`}
        >
            <div className="relative flex items-start justify-between gap-3">
                <div className={`p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/50 ${a.text}`}>
                    <Icon className="w-4 h-4" />
                </div>
                <span className={`w-1.5 h-1.5 rounded-full ${a.dot} mt-2 opacity-70`} />
            </div>
            <div className="relative mt-4">
                <div className="flex items-end gap-2">
                    {showError ? (
                        <span className="text-3xl font-bold tabular-nums text-slate-300 dark:text-slate-600 ds-font-display leading-none">
                            —
                        </span>
                    ) : (
                        <CountUp
                            value={loading ? 0 : (value ?? 0)}
                            format={(n) => (n > 999 ? '999+' : String(n))}
                            className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50 ds-font-display leading-none"
                        />
                    )}
                    {loading && (
                        <Skeleton className="inline-block w-10 h-7 rounded-md" />
                    )}
                    {!showError && (
                        <div className="flex flex-col items-start gap-0.5 pb-0.5">
                            <DeltaBadge pct={delta} />
                            <Sparkline history={history} accent={a.sparkColor} />
                        </div>
                    )}
                </div>
                <div className="ds-eyebrow mt-2 text-slate-500 dark:text-slate-400">
                    {label}
                </div>
                {showError ? (
                    <div className="mt-0.5 ds-text-meta text-rose-500/80 dark:text-rose-400/80">couldn't load</div>
                ) : (
                    hint && <div className="mt-0.5 ds-text-meta text-slate-500 dark:text-slate-400">{hint}</div>
                )}
            </div>
        </button>
    )
}

export function KpiRow({ activeTab, setActiveTab, reviews, stale, issues, debt, snapshots = [] }) {
    const reviewsCount = Array.isArray(reviews.data) ? reviews.data.length : 0
    const staleCount = Array.isArray(stale.data) ? stale.data.length : 0
    const issuesCount = Array.isArray(issues.data) ? issues.data.length : 0
    const debtCount = debt.data?.items?.length ?? 0

    // "Errored" = the fetch failed AND we never received data to fall back on.
    // The hooks keep last-known-good data on error, so a populated tile still
    // shows real numbers; only a never-loaded tile flips to the honest state.
    const reviewsErrored = Boolean(reviews.error) && !Array.isArray(reviews.data)
    const staleErrored = Boolean(stale.error) && !Array.isArray(stale.data)
    const issuesErrored = Boolean(issues.error) && !Array.isArray(issues.data)
    const debtErrored = Boolean(debt.error) && !Array.isArray(debt.data?.items)

    const oldestReviewHours = reviewsCount > 0
        ? Math.max(...reviews.data.map(r => r.ageHours || 0))
        : 0
    const oldestStaleDays = staleCount > 0
        ? Math.max(...stale.data.map(p => p.ageDays || 0))
        : 0
    const hotspotRepo = debt.data?.hotspots?.[0]?.repoFullName || null

    const reviewsHistory  = snapshots.map(s => s.reviews)
    const stalePRsHistory = snapshots.map(s => s.stalePRs)
    const issuesHistory   = snapshots.map(s => s.issues)
    const techDebtHistory = snapshots.map(s => s.techDebt)

    return (
        // 2x2 below 640px (was grid-cols-1 — one KPI per screen pushed the tab
        // strip and the actual work items ~4 screens below the fold on the
        // surface whose entire purpose is that list, U24).
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <KpiTile
                icon={GitPullRequest}
                label="Pending reviews"
                value={reviewsCount}
                hint={reviewsCount > 0 ? `oldest ${ageLabel(oldestReviewHours)}` : 'all caught up'}
                loading={reviews.loading}
                errored={reviewsErrored}
                accent="brand"
                active={activeTab === 'reviews'}
                onClick={() => setActiveTab('reviews')}
                history={reviewsHistory}
            />
            <KpiTile
                icon={AlertTriangle}
                label="Stale PRs"
                value={staleCount}
                hint={staleCount > 0 ? `oldest ${dayLabel(oldestStaleDays)}` : 'nothing stale'}
                loading={stale.loading}
                errored={staleErrored}
                accent="attention"
                active={activeTab === 'stale'}
                onClick={() => setActiveTab('stale')}
                history={stalePRsHistory}
            />
            <KpiTile
                icon={CircleDot}
                label="Open issues"
                value={issuesCount}
                hint={issuesCount > 0 ? 'assigned to you' : 'nothing on your plate'}
                loading={issues.loading}
                errored={issuesErrored}
                accent="brand"
                active={activeTab === 'issues'}
                onClick={() => setActiveTab('issues')}
                history={issuesHistory}
            />
            <KpiTile
                icon={Wrench}
                label="Tech debt"
                value={debtCount}
                hint={hotspotRepo ? `hotspot: ${hotspotRepo.split('/').pop()}` : 'no debt tracked'}
                loading={debt.loading}
                errored={debtErrored}
                accent="brand"
                active={activeTab === 'techdebt'}
                onClick={() => setActiveTab('techdebt')}
                history={techDebtHistory}
            />
        </div>
    )
}
