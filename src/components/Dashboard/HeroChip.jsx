import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'

export const HeroChip = forwardRef(function HeroChip(
    { icon: Icon, label, hasMenu = false, onClick, disabled = false, busy = false, children, className = '', ...rest },
    ref
) {
    const baseClass = 'inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-busy={busy ? 'true' : undefined}
            className={`${baseClass} ${className}`.trim()}
            {...rest}
        >
            {Icon && <Icon className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 ${busy ? 'animate-spin' : ''}`} />}
            {children ?? <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[12rem]">{label}</span>}
            {hasMenu && <ChevronDown data-chevron className="w-3.5 h-3.5 text-slate-400" />}
        </button>
    )
})
