import { twMerge } from 'tailwind-merge'

const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 dark:shadow-indigo-900/50 active:scale-[0.98] ds-btn-shimmer ds-focus-ring',
    secondary: 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-600 shadow-sm dark:shadow-slate-900/50 active:scale-[0.98] ds-focus-ring',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-200 dark:shadow-red-900/50 active:scale-[0.98] ds-focus-ring',
    warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm shadow-amber-200 dark:shadow-amber-900/50 active:scale-[0.98] ds-focus-ring',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-200 dark:shadow-emerald-900/50 active:scale-[0.98] ds-focus-ring',
    info: 'bg-sky-500 text-white hover:bg-sky-600 shadow-sm shadow-sky-200 dark:shadow-sky-900/50 active:scale-[0.98] ds-focus-ring',
    ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 ds-focus-ring',
}

const sizes = {
    // xs is intentionally below the WCAG 44px tap-target floor — for tight
    // inline chrome (toolbar pills, banner CTAs) where the surrounding
    // layout already constrains the click area. Use sparingly; sm/md/lg
    // should stay the default for primary CTAs.
    xs: 'px-2 py-1 text-[11px] gap-1',
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-6 py-3 text-base gap-2.5',
}

// Sizes that opt out of the 44px minimum target. Keep this list explicit so
// adding another opt-out size is a deliberate accessibility decision.
const SIZES_WITHOUT_MIN_TARGET = new Set(['xs'])

export function Button({ className, variant = 'primary', size = 'md', children, ...props }) {
    const enforcesMinTarget = !SIZES_WITHOUT_MIN_TARGET.has(size)
    return (
        <button
            className={twMerge(
                'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-indigo-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
                enforcesMinTarget && 'min-h-[44px] min-w-[44px]',
                variants[variant] || variants.primary,
                sizes[size] || sizes.md,
                className
            )}
            {...props}
        >
            {children}
        </button>
    )
}
