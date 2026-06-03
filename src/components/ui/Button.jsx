import { twMerge } from 'tailwind-merge'

const variants = {
    primary: 'bg-[color:var(--ds-accent-brand)] text-white hover:bg-[color:var(--ds-accent-brand-hover)] shadow-sm ds-focus-ring',
    secondary: 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-600 disabled:text-slate-400 dark:disabled:text-slate-500 shadow-sm dark:shadow-slate-900/50 ds-focus-ring',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm ds-focus-ring',
    warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm ds-focus-ring',
    success: 'bg-[color:var(--ds-cta)] dark:bg-[color:var(--ds-cta-dark)] text-white hover:bg-[color:var(--ds-cta-hover)] dark:hover:bg-[color:var(--ds-cta-hover-dark)] shadow-sm ds-focus-ring',
    info: 'bg-sky-500 text-white hover:bg-sky-600 shadow-sm ds-focus-ring',
    ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 disabled:text-slate-400 dark:disabled:text-slate-500 ds-focus-ring',
    // Outline variants — transparent bg with coloured border + matching text.
    // For tight CTAs that read as 'soft' actions (Replace / Rename / Skip in
    // ConflictPanel, similar in BulkActions). Hover fills the bg lightly to
    // match the existing call-sites' look.
    outline: 'bg-transparent text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 ds-focus-ring',
    'outline-danger': 'bg-transparent text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 ds-focus-ring',
    'outline-primary': 'bg-transparent text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 ds-focus-ring',
    // Soft variants — tinted background with matching text, no border.
    // For inline destructive / accent CTAs that should read as 'a step
    // softer than danger' (AIConfigSection Remove key, soft-indigo Test
    // Connection, etc).
    'soft-danger': 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 ds-focus-ring',
    'soft-primary': 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-700/50 ds-focus-ring',
}

const sizes = {
    // xs is intentionally below the WCAG 44px tap-target floor — for tight
    // inline chrome (toolbar pills, banner CTAs) where the surrounding
    // layout already constrains the click area. Use sparingly; sm/md/lg
    // should stay the default for primary CTAs.
    xs: 'px-2 py-1 ds-text-meta gap-1',
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
                'inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed',
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
