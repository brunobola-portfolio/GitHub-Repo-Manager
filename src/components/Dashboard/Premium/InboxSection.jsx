export function InboxSection({ label, count = 0, active = false, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'true' : undefined}
            className={[
                'group w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                active
                    ? 'bg-brand-500/10 text-slate-900 dark:text-slate-50 font-medium'
                    // Muted by colour, never by opacity: opacity-70 over slate-600 /
                    // slate-400 measured 3.59:1 light and 3.97:1 dark (axe 4.13).
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900/40',
                'ds-focus-ring',
            ].join(' ')}
        >
            <span className="truncate">{label}</span>
            <span
                aria-live="polite"
                className={[
                    'shrink-0 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full ds-text-meta font-semibold ds-font-mono tabular-nums',
                    count > 0
                        ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                        : 'bg-slate-200/60 dark:bg-slate-800 text-slate-500',
                ].join(' ')}
            >
                {count}
            </span>
        </button>
    );
}
