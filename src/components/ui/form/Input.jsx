import { forwardRef, useId } from 'react'
import { twMerge } from 'tailwind-merge'

/**
 * Input — premium text input primitive.
 *
 * Visual language matches Select.jsx (backdrop-blur glass, soft hover lift,
 * indigo focus ring) so forms feel cohesive across the app. Honours the
 * 44px tap-target floor by default.
 *
 * Props:
 *  - leadingIcon?:    Component  Icon component rendered inside, left edge.
 *  - trailing?:       ReactNode  Slot rendered inside, right edge (icons,
 *                                 inline action buttons, status indicator).
 *  - status?:         'idle'|'error'|'success'  Tints the border + ring.
 *  - size?:           'sm'|'md'                  md is the 44px default.
 *  - tone?:           'indigo'|'emerald'         Focus accent. Some flows
 *                                                 (Create / Confirm) use the
 *                                                 emerald CTA family.
 */
export const Input = forwardRef(function Input(
    {
        className,
        leadingIcon: LeadingIcon,
        trailing,
        status = 'idle',
        size = 'md',
        tone = 'indigo',
        id: idProp,
        ...rest
    },
    ref,
) {
    const reactId = useId()
    const id = idProp ?? reactId

    const sizeClass = size === 'sm'
        ? 'h-9 text-xs'
        : 'h-11 text-sm'

    const padLeft = LeadingIcon ? 'pl-10' : 'pl-3.5'
    const padRight = trailing ? 'pr-10' : 'pr-3.5'

    const accentBorder = tone === 'emerald'
        ? 'focus:border-emerald-500 focus:ring-emerald-500/30 hover:border-emerald-200 dark:hover:border-emerald-500/40'
        : 'focus:border-[color:var(--ds-accent-brand)] focus:ring-[var(--ds-accent-ring)] hover:border-indigo-200 dark:hover:border-indigo-500/40'

    const statusClass =
        status === 'error'
            ? 'border-rose-300 dark:border-rose-500/50 focus:border-rose-500 focus:ring-rose-500/30'
            : status === 'success'
                ? 'border-emerald-300 dark:border-emerald-500/50 focus:border-emerald-500 focus:ring-emerald-500/30'
                : `border-slate-200 dark:border-slate-700 ${accentBorder}`

    return (
        <div className="relative">
            {LeadingIcon && (
                <span
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                >
                    <LeadingIcon className="w-4 h-4" />
                </span>
            )}
            <input
                ref={ref}
                id={id}
                className={twMerge(
                    'block w-full rounded-xl font-medium',
                    'bg-white/80 dark:bg-slate-900/60 backdrop-blur-sm',
                    'text-slate-900 dark:text-slate-100',
                    'placeholder:text-slate-400 dark:placeholder:text-slate-500',
                    'border outline-none transition-all duration-150',
                    'focus:ring-4 focus:shadow-sm',
                    'disabled:opacity-60 disabled:cursor-not-allowed',
                    sizeClass,
                    padLeft,
                    padRight,
                    statusClass,
                    className,
                )}
                aria-invalid={status === 'error' || undefined}
                {...rest}
            />
            {trailing && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center text-slate-400 dark:text-slate-500">
                    {trailing}
                </span>
            )}
        </div>
    )
})
