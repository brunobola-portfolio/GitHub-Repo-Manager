import { GitPullRequest, AlertTriangle, CircleDot, Wrench } from 'lucide-react'
import { ageLabel, dayLabel } from './shared/formatters'

const KPI_ACCENTS = {
    purple:  { ring: 'from-purple-500/20',  dot: 'bg-purple-500',  text: 'text-purple-600 dark:text-purple-300' },
    amber:   { ring: 'from-amber-500/20',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-300' },
    emerald: { ring: 'from-emerald-500/20', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-300' },
    indigo:  { ring: 'from-indigo-500/20',  dot: 'bg-indigo-500',  text: 'text-indigo-600 dark:text-indigo-300' },
}

function KpiTile({ icon: Icon, label, value, hint, loading, accent = 'indigo', onClick, active }) {
    const a = KPI_ACCENTS[accent] || KPI_ACCENTS.indigo
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
                <div className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50 ds-font-display leading-none">
                    {loading ? <span className="inline-block w-10 h-7 rounded-md bg-slate-200 dark:bg-slate-700 animate-pulse" /> : (value ?? 0)}
                </div>
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {label}
                </div>
                {hint && <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>}
            </div>
        </button>
    )
}

export function KpiRow({ activeTab, setActiveTab, reviews, stale, issues, debt }) {
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
            />
        </div>
    )
}
