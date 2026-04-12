import { GitPullRequest, FileCode } from 'lucide-react'

export function PRSelector({ pulls = [], loading, onSelect }) {
    if (loading) {
        return <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 ds-skeleton rounded-xl" />)}</div>
    }

    if (!pulls.length) {
        return <div className="text-center text-sm text-slate-400 dark:text-slate-500 py-8">No open pull requests</div>
    }

    return (
        <div className="space-y-2 max-h-72 overflow-auto">
            {pulls.map(pr => (
                <button
                    key={pr.number}
                    type="button"
                    onClick={() => onSelect(pr)}
                    className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                    <div className="flex items-start gap-2">
                        <GitPullRequest className={`w-4 h-4 mt-0.5 shrink-0 ${pr.draft ? 'text-slate-400' : 'text-emerald-500'}`} />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                                {pr.title} <span className="text-slate-400 font-normal">#{pr.number}</span>
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                                <span>{pr.user?.login}</span>
                                {pr.draft && <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400">Draft</span>}
                                <span className="flex items-center gap-0.5"><FileCode className="w-3 h-3" />{pr.changed_files || '?'}</span>
                            </div>
                        </div>
                    </div>
                </button>
            ))}
        </div>
    )
}
