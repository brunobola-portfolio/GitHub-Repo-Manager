import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card } from '../ui/Card'

export const HeroChip = forwardRef(function HeroChip(
    { icon: Icon, label, hasMenu = false, onClick, disabled = false, busy = false, children, className = '', ...rest },
    ref
) {
    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-busy={busy ? 'true' : undefined}
            className={`inline-flex rounded-xl ds-focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${className}`.trim()}
            {...rest}
        >
            <Card shadow="none" className="inline-flex items-center gap-2 h-9 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                {Icon && <Icon className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 ${busy ? 'animate-spin' : ''}`} />}
                {children ?? <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[12rem]">{label}</span>}
                {hasMenu && <ChevronDown data-chevron className="w-3.5 h-3.5 text-slate-400" />}
            </Card>
        </button>
    )
})
