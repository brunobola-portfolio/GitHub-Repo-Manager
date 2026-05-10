export function InboxSection({ label, count = 0, active = false, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'true' : 'false'}
            className={[
                'group w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                active
                    ? 'bg-indigo-500/10 text-zinc-900 dark:text-zinc-50 font-medium'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/40',
            ].join(' ')}
        >
            <span className="truncate">{label}</span>
            <span
                className={[
                    'shrink-0 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-[11px] font-semibold ds-font-mono tabular-nums',
                    count > 0
                        ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                        : 'bg-zinc-200/60 dark:bg-zinc-800 text-zinc-500',
                ].join(' ')}
            >
                {count}
            </span>
        </button>
    );
}
