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
 *  - bare?:           boolean                    Drop the surface (bg/border/
 *                                                 ring/radius) and keep only
 *                                                 typography + padding. For a
 *                                                 combobox that supplies its
 *                                                 own outer chrome (a listbox
 *                                                 wrapper, a dropdown shell) —
 *                                                 the input still needs Input's
 *                                                 sizing/placeholder/disabled
 *                                                 rules, just not a second box.
 */
export const Input = forwardRef(function Input(
    {
        className,
        leadingIcon: LeadingIcon,
        trailing,
        status = 'idle',
        size = 'md',
        tone = 'indigo',
        bare = false,
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
        : 'focus:border-[color:var(--ds-accent-brand)] focus:ring-[var(--ds-accent-ring)] hover:border-brand-200 dark:hover:border-brand-500/40'

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
                    'block w-full font-medium',
                    'text-slate-900 dark:text-slate-100',
                    'placeholder:text-slate-500 dark:placeholder:text-slate-400',
                    'outline-none transition-all duration-150',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    bare
                        ? 'bg-transparent border-0 focus:ring-0'
                        : twMerge(
                            'rounded-xl bg-white/80 dark:bg-slate-900/60 backdrop-blur-sm border focus:ring-4 focus:shadow-sm',
                            statusClass,
                        ),
                    sizeClass,
                    padLeft,
                    padRight,
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
