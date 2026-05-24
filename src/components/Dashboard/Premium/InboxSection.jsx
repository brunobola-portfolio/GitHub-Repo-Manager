export function InboxSection({ label, count = 0, active = false, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'true' : undefined}
            className={[
                'group w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                active
                    ? 'bg-indigo-500/10 text-slate-900 dark:text-slate-50 font-medium'
                    : 'opacity-70 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900/40',
            ].join(' ')}
        >
            <span className="truncate">{label}</span>
            <span
                aria-live="polite"
                className={[
                    'shrink-0 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-[11px] font-semibold ds-font-mono tabular-nums',
                    count > 0
                        ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                        : 'bg-slate-200/60 dark:bg-slate-800 text-slate-500',
                ].join(' ')}
            >
                {count}
            </span>
        </button>
    );
}
