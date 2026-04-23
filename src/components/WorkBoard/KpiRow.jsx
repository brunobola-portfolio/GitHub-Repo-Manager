import { useEffect, useState } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import { clsx } from 'clsx'
import { GitPullRequest, AlertTriangle, CircleDot, Wrench } from 'lucide-react'
import { ageLabel, dayLabel } from './shared/formatters'

function computeDelta(history) {
    if (!Array.isArray(history) || history.length < 2) return null
    const first = history[0]
    const last = history[history.length - 1]
    if (first === 0) return null
    return Math.round(((last - first) / first) * 100)
}

function Sparkline({ history, accent }) {
    if (!Array.isArray(history) || history.length < 3) return null
    const W = 40, H = 16
    const min = Math.min(...history)
    const max = Math.max(...history)
    const range = max - min || 1
    const points = history.map((v, i) => {
        const x = (i / (history.length - 1)) * W
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
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
            />
        </svg>
    )
}

function DeltaBadge({ pct }) {
    if (pct === null) return null
    const flat = Math.abs(pct) < 5
    const up = pct > 0
    const label = flat ? '—' : (up ? `+${pct}%` : `${pct}%`)
    const color = flat ? 'text-slate-400' : up ? 'text-amber-400' : 'text-emerald-400'
    return (
        <motion.span
            className={clsx('text-[10px] font-medium tabular-nums', color)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.3 }}
        >
            {label}
        </motion.span>
    )
}

function CountUp({ target, className }) {
    const motionVal = useMotionValue(0)
    const spring = useSpring(motionVal, { stiffness: 80, damping: 20 })
    const [display, setDisplay] = useState(0)

    useEffect(() => {
        motionVal.set(target)
    }, [target, motionVal])

    useEffect(() => {
        const unsub = spring.on('change', v => setDisplay(Math.round(v)))
        return unsub
    }, [spring])

    return (
        <span className={className}>
            {display > 999 ? '999+' : display}
        </span>
    )
}

const KPI_ACCENTS = {
    purple:  { ring: 'from-purple-500/20',  dot: 'bg-purple-500',  text: 'text-purple-600 dark:text-purple-300',  sparkColor: '#a78bfa' },
    amber:   { ring: 'from-amber-500/20',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-300',    sparkColor: '#fbbf24' },
    emerald: { ring: 'from-emerald-500/20', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-300', sparkColor: '#34d399' },
    indigo:  { ring: 'from-indigo-500/20',  dot: 'bg-indigo-500',  text: 'text-indigo-600 dark:text-indigo-300',  sparkColor: '#818cf8' },
}

function KpiTile({ icon: Icon, label, value, hint, loading, accent = 'indigo', onClick, active, history }) {
    const a = KPI_ACCENTS[accent] || KPI_ACCENTS.indigo
    const delta = computeDelta(history)

    return (
        <button
            type="button"
            onClick={onClick}
            className={`
                group relative text-left p-5 rounded-2xl border backdrop-blur-xl overflow-hidden
                transition-all duration-300 ds-hover-lift
                ${active
                    ? 'border-indigo-400/60 dark:border-indigo-500/50 bg-white dark:bg-slate-900 shadow-lg shadow-indigo-500/10'
                    : 'border-slate-200/60 dark:border-slate-700/40 bg-white/70 dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-600'
                }
            `}
        >
            <div className={`absolute -top-10 -right-10 w-28 h-28 rounded-full bg-gradient-to-br ${a.ring} to-transparent blur-2xl opacity-70 group-hover:opacity-100 transition-opacity`} />
            <div className="relative flex items-start justify-between gap-3">
                <div className={`p-2 rounded-xl bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 border border-slate-200/60 dark:border-slate-700/50 ${a.text}`}>
                    <Icon className="w-4 h-4" />
                </div>
                <span className={`w-1.5 h-1.5 rounded-full ${a.dot} mt-2 opacity-70`} />
            </div>
            <div className="relative mt-4">
                <div className="flex items-end gap-2">
                    <CountUp
                        target={loading ? 0 : (value ?? 0)}
                        className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50 ds-font-display leading-none"
                    />
                    {loading && (
                        <span className="inline-block w-10 h-7 rounded-md bg-slate-200 dark:bg-slate-700 animate-pulse" />
                    )}
                    <div className="flex flex-col items-start gap-0.5 pb-0.5">
                        <DeltaBadge pct={delta} />
                        <Sparkline history={history} accent={a.sparkColor} />
                    </div>
                </div>
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {label}
                </div>
                {hint && <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>}
            </div>
        </button>
    )
}

export function KpiRow({ activeTab, setActiveTab, reviews, stale, issues, debt, snapshots = [] }) {
    const reviewsCount = Array.isArray(reviews.data) ? reviews.data.length : 0
    const staleCount = Array.isArray(stale.data) ? stale.data.length : 0
    const issuesCount = Array.isArray(issues.data) ? issues.data.length : 0
    const debtCount = debt.data?.items?.length ?? 0

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiTile
                icon={GitPullRequest}
                label="Pending reviews"
                value={reviewsCount}
                hint={reviewsCount > 0 ? `oldest ${ageLabel(oldestReviewHours)}` : 'all caught up'}
                loading={reviews.loading}
                accent="purple"
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
                accent="amber"
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
                accent="emerald"
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
                accent="indigo"
                active={activeTab === 'techdebt'}
                onClick={() => setActiveTab('techdebt')}
                history={techDebtHistory}
            />
        </div>
    )
}
