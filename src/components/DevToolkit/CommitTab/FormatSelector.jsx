const FORMATS = [
    { id: 'conventional', label: 'Conventional' },
    { id: 'gitmoji', label: 'Gitmoji' },
    { id: 'descriptive', label: 'Descriptive' },
    { id: 'repo-convention', label: 'Repo Convention' },
]

export function FormatSelector({ selected, onSelect, repoStyleLoading }) {
    return (
        <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200/40 dark:border-slate-700/40">
            {FORMATS.map(f => (
                <button
                    key={f.id}
                    type="button"
                    onClick={() => onSelect(f.id)}
                    disabled={f.id === 'repo-convention' && repoStyleLoading}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                        selected === f.id
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    } disabled:opacity-40`}
                >
                    {f.label}
                </button>
            ))}
        </div>
    )
}
