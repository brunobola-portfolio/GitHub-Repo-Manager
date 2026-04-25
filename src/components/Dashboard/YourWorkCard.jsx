import { useEffect, useState } from 'react'
import { Sparkles, ArrowRight, GitPullRequest, Clock, CircleDot } from 'lucide-react'
import { Card } from '../ui/Card'

async function fetchCount(url) {
    try {
        const res = await fetch(url, { credentials: 'include' })
        if (res.status === 401 || res.status === 403 || res.status === 404) {
            return { count: 0, hidden: true }
        }
        if (!res.ok) return { count: 0, hidden: false }
        const body = await res.json()
        return { count: Array.isArray(body?.data) ? body.data.length : 0, hidden: false }
    } catch {
        return { count: 0, hidden: false }
    }
}

export function YourWorkCard({ onOpenBoard }) {
    const [state, setState] = useState({ status: 'loading', reviews: 0, stale: 0, issues: 0, hidden: false })

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const [r, s, i] = await Promise.all([
                fetchCount('/api/v1/work-board/my-reviews?limit=50'),
                fetchCount('/api/v1/work-board/stale-prs?limit=50'),
                fetchCount('/api/v1/work-board/my-issues?limit=50'),
            ])
            if (cancelled) return
            const hidden = r.hidden && s.hidden && i.hidden
            setState({ status: 'ready', reviews: r.count, stale: s.count, issues: i.count, hidden })
        })()
        return () => { cancelled = true }
    }, [])

    if (state.hidden) return null

    return (
        <Card glass={false} className="bg-gradient-to-br from-indigo-50/60 to-purple-50/40 dark:from-indigo-950/30 dark:to-purple-950/20 p-5 ds-card-shimmer">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white ds-font-display">Your work</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Live counts across your tracked repos</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onOpenBoard}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100/60 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                >
                    Open board
                    <ArrowRight className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4">
                <Stat icon={GitPullRequest} label="reviews waiting" value={state.reviews} tone="indigo" />
                <Stat icon={Clock} label="stale PRs" value={state.stale} tone="amber" />
                <Stat icon={CircleDot} label="issues" value={state.issues} tone="emerald" />
            </div>
        </Card>
    )
}

const TONE = {
    indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
}

function Stat({ icon: Icon, label, value, tone }) {
    return (
        <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${TONE[tone]}`}>
                <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="text-sm">
                <div className="font-semibold text-slate-900 dark:text-white">
                    {value} {value === 1 ? label.replace(/s$/, '') : label}
                </div>
            </div>
        </div>
    )
}
