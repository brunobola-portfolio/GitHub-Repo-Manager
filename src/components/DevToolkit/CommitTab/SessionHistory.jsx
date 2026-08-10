export function SessionHistory({ items = [], onRestore }) {
    if (!items.length) return null

    return (
        <div className="flex gap-1.5 overflow-x-auto py-1 scrollbar-thin">
            <span className="ds-text-micro text-slate-500 dark:text-slate-400 uppercase tracking-wide shrink-0 self-center">History:</span>
            {items.map((msg, i) => (
                <button
                    key={i}
                    type="button"
                    onClick={() => onRestore(msg)}
                    className="shrink-0 max-w-[200px] truncate px-2 py-0.5 ds-text-meta font-mono rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-600 dark:hover:text-brand-300 border border-slate-200 dark:border-slate-700 transition-colors"
                    title={msg}
                >
                    {msg.split('\n')[0]}
                </button>
            ))}
        </div>
    )
}
