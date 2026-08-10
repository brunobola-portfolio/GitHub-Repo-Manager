import { forwardRef, useId } from 'react'
import { twMerge } from 'tailwind-merge'

/**
 * Textarea — premium multi-line input primitive. Shares the visual
 * language with <Input /> and <Select /> (glass surface, indigo focus
 * ring) and exposes a `trailing` slot for inline action buttons (e.g.
 * the AI ✨ magic generator inside CreateRepoModal).
 */
export const Textarea = forwardRef(function Textarea(
    {
        className,
        trailing,
        status = 'idle',
        tone = 'indigo',
        rows = 4,
        id: idProp,
        ...rest
    },
    ref,
) {
    const reactId = useId()
    const id = idProp ?? reactId

    const accentBorder = tone === 'emerald'
        ? 'focus:border-emerald-500 focus:ring-emerald-500/30 hover:border-emerald-200 dark:hover:border-emerald-500/40'
        : 'focus:border-[color:var(--ds-accent-brand)] focus:ring-[var(--ds-accent-ring)] hover:border-brand-200 dark:hover:border-brand-500/40'

    const statusClass =
        status === 'error'
            ? 'border-rose-300 dark:border-rose-500/50 focus:border-rose-500 focus:ring-rose-500/30'
            : status === 'success'
                ? 'border-emerald-300 dark:border-emerald-500/50 focus:border-emerald-500 focus:ring-emerald-500/30'
                : `border-slate-200 dark:border-slate-700 ${accentBorder}`

    return (
        <div className="relative">
            <textarea
                ref={ref}
                id={id}
                rows={rows}
                className={twMerge(
                    'block w-full rounded-xl font-medium text-sm',
                    'bg-white/80 dark:bg-slate-900/60 backdrop-blur-sm',
                    'text-slate-900 dark:text-slate-100',
                    'placeholder:text-slate-500 dark:placeholder:text-slate-400',
                    'border outline-none transition-all duration-150 resize-none',
                    'focus:ring-4 focus:shadow-sm',
                    'disabled:opacity-60 disabled:cursor-not-allowed',
                    'px-3.5 py-3',
                    trailing ? 'pr-12' : '',
                    statusClass,
                    className,
                )}
                aria-invalid={status === 'error' || undefined}
                {...rest}
            />
            {trailing && (
                <span className="absolute right-2.5 bottom-2.5 flex items-center">
                    {trailing}
                </span>
            )}
        </div>
    )
})
