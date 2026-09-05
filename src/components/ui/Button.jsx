import { forwardRef } from 'react'
import { twMerge } from 'tailwind-merge'

const variants = {
    primary: 'ds-brand-solid ds-elevation-sm ds-focus-ring',
    secondary: 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-600 disabled:text-slate-400 dark:disabled:text-slate-500 ds-elevation-sm dark:shadow-slate-900/50 ds-focus-ring',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 ds-elevation-sm ds-focus-ring',
    // amber-700, not 500: white on amber-500 is 2.15:1 and fails AA as text
    // on a button (amber-600 is 3.19:1, still short). 700 is 5.02:1; the fill
    // stays unmistakably amber. Same pair on the four ad-hoc copies outside.
    warning: 'bg-amber-700 text-white hover:bg-amber-800 ds-elevation-sm ds-focus-ring',
    success: 'bg-[color:var(--ds-cta)] dark:bg-[color:var(--ds-cta-dark)] text-white hover:bg-[color:var(--ds-cta-hover)] dark:hover:bg-[color:var(--ds-cta-hover-dark)] ds-elevation-sm ds-focus-ring',
    info: 'bg-brand-500 text-white hover:bg-brand-600 ds-elevation-sm ds-focus-ring',
    ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 disabled:text-slate-400 dark:disabled:text-slate-500 ds-focus-ring',
    // Outline variants — transparent bg with coloured border + matching text.
    // For tight CTAs that read as 'soft' actions (Replace / Rename / Skip in
    // ConflictPanel, similar in BulkActions). Hover fills the bg lightly to
    // match the existing call-sites' look.
    outline: 'bg-transparent text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 ds-focus-ring',
    'outline-danger': 'bg-transparent text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 ds-focus-ring',
    'outline-primary': 'bg-transparent text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] border border-brand-300 dark:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-900/30 ds-focus-ring',
    // Soft variants — tinted background with matching text, no border.
    // For inline destructive / accent CTAs that should read as 'a step
    // softer than danger' (AIConfigSection Remove key, soft-indigo Test
    // Connection, etc).
    'soft-danger': 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30 ds-focus-ring',
    'soft-primary': 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 border border-brand-200 dark:border-brand-700/50 ds-focus-ring',
    'soft-warning': 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 ds-focus-ring',
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

// forwardRef so a <Button> can be the direct child of <Tooltip> (which clones
// its child and needs a real ref onto the rendered <button> to measure/
// position the bubble) — any button that wants an explanatory hover label
// instead of native title= needs this.
export const Button = forwardRef(function Button({ className, variant = 'primary', size = 'md', type = 'button', children, ...props }, ref) {
    const enforcesMinTarget = !SIZES_WITHOUT_MIN_TARGET.has(size)
    return (
        <button
            ref={ref}
            // Default to type="button" so this shared primitive never submits a
            // surrounding <form> by accident. Submit buttons pass type="submit"
            // explicitly (every form in the app already does).
            type={type}
            // Subtle tactile press (3% shrink) via CSS so the primitive stays a
            // plain <button> — no Framer overhead on the most-used control. The
            // `motion-safe:` guard drops the scale entirely under prefers-reduced-
            // motion. `transition` (not `transition-colors`) so the transform eases
            // too. `active:` doesn't fire on disabled buttons.
            className={twMerge(
                'inline-flex items-center justify-center rounded-lg font-medium transition duration-150 motion-safe:active:scale-[0.97] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed',
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
})
