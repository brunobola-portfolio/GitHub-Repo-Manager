import { useMemo } from 'react'
import { GitBranch, Sparkles, Layers, AlertTriangle, Shield } from 'lucide-react'
import { computeBranchHygiene } from '../../utils/branchHygiene'

/**
 * BranchHygieneCard — collapsible at-a-glance summary of the branch list.
 * Pure client-side computation over the array we already fetched, so it
 * adds zero load time. Surfaces three signals:
 *   - prefix clustering ("feat/* has 8 branches") to suggest cleanup
 *   - throwaway names ("wip", "test-3", "fix-typo") to suggest deletion
 *   - protection coverage ratio
 *
 * Renders nothing when the list is empty or there are no actionable
 * signals — we don't want to add noise on healthy repos.
 */
export function BranchHygieneCard({ branches, defaultBranch = 'main', className = '' }) {
    const insights = useMemo(
        () => computeBranchHygiene(branches, { defaultBranch }),
        [branches, defaultBranch],
    )

    const hasSignal = insights.prefixes.length > 0 || insights.suspicious.length > 0 || insights.total >= 5
    if (!hasSignal) return null

    const protectedPct = Math.round(insights.protectedRatio * 100)

    return (
        <section
            aria-labelledby="branch-hygiene-title"
            className={`rounded-2xl p-[1px] bg-gradient-to-br from-indigo-500/30 via-purple-500/20 to-pink-500/10 dark:from-indigo-500/40 dark:via-purple-500/30 dark:to-pink-500/20 ${className}`.trim()}
        >
            <div className="rounded-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-4 space-y-4">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" aria-hidden="true" />
                    <h3 id="branch-hygiene-title" className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
                        Branch hygiene
                    </h3>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Stat icon={GitBranch} label="Total" value={insights.total} tone="indigo" />
                    <Stat icon={Shield} label="Protected" value={`${insights.protected}`} hint={`${protectedPct}%`} tone="emerald" />
                    <Stat icon={Layers} label="Prefix groups" value={insights.prefixes.length} tone="sky" />
                    <Stat icon={AlertTriangle} label="Suspicious" value={insights.suspicious.length} tone={insights.suspicious.length ? 'amber' : 'slate'} />
                </div>

                {insights.prefixes.length > 0 && (
                    <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                            Largest prefix clusters
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {insights.prefixes.map((p) => (
                                <span
                                    key={p.prefix}
                                    title={p.names.join('\n')}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200 ring-1 ring-inset ring-indigo-200/60 dark:ring-indigo-800"
                                >
                                    {p.prefix}/*
                                    <span className="font-sans font-semibold">{p.count}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {insights.suspicious.length > 0 && (
                    <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1.5">
                            Likely throwaway branches
                        </div>
                        <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
                            {insights.suspicious.slice(0, 6).map((s) => (
                                <li key={s.name} className="flex items-center gap-1.5">
                                    <span className="font-mono px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-200 ring-1 ring-inset ring-amber-200/60 dark:ring-amber-800/60">
                                        {s.name}
                                    </span>
                                    <span className="text-slate-500 dark:text-slate-400 truncate" title={s.detail}>{s.detail}</span>
                                </li>
                            ))}
                            {insights.suspicious.length > 6 && (
                                <li className="text-[11px] text-slate-500 dark:text-slate-400">
                                    +{insights.suspicious.length - 6} more — consider sweeping these branches.
                                </li>
                            )}
                        </ul>
                    </div>
                )}
            </div>
        </section>
    )
}

const TONE = {
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200/60 dark:bg-indigo-900/30 dark:text-indigo-200 dark:ring-indigo-800/60',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800/60',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200/60 dark:bg-sky-900/30 dark:text-sky-200 dark:ring-sky-800/60',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800/60',
    slate: 'bg-slate-50 text-slate-600 ring-slate-200/60 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
}

function Stat({ icon: Icon, label, value, hint, tone = 'slate' }) {
    return (
        <div className={`rounded-xl px-3 py-2 ring-1 ring-inset ${TONE[tone] ?? TONE.slate}`}>
            <div className="flex items-center justify-between gap-2">
                <Icon className="w-3.5 h-3.5 opacity-70" aria-hidden="true" />
                <span className="text-base font-bold leading-none tabular-nums">{value}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wide opacity-80">
                <span>{label}</span>
                {hint && <span className="font-semibold tabular-nums">{hint}</span>}
            </div>
        </div>
    )
}
