import { twMerge } from 'tailwind-merge'

// Elevation reads from the design-system pair, which is theme-aware at the
// token level — so no `dark:` variant here (see --ds-shadow-* in
// design-system.css). The `shadow-slate-200/40` this replaces tinted the shadow
// slate-200 at 40%, i.e. the colour of the slate-50 page it falls on: measured
// 1.07:1 against the page, which is why light mode had no elevation at all.
//
// Card = neutral (this file). InsightCard (./InsightCard.jsx) = tinted. Both
// share the same radius token (--ds-radius-lg) and draw their shadow from
// this same --ds-shadow-* scale (InsightCard uses the lighter `sm` step,
// appropriate to its denser, more-numerous-per-screen usage) so geometry
// never drifts between them — tone is the only intended difference (F20).
const SHADOW_CLASS = {
    lg: 'shadow-[var(--ds-shadow-lg)]',
    sm: 'shadow-[var(--ds-shadow-sm)]',
    none: '',
}

export function Card({
    children,
    className,
    hover = false,
    glass = false,
    shadow = 'lg',
    ref,
    ...props
}) {
    return (
        <div ref={ref} {...props} className={twMerge(
            // Base styling — solid by default; glass opt-in
            glass
                ? 'bg-white/80 dark:bg-slate-800/80 backdrop-blur-md'
                : 'bg-white dark:bg-slate-900',
            // Borders — --ds-elevation-border is the boundary token (1.73:1 on
            // white vs slate-200's 1.23:1, matching dark mode's 1.72:1). Kept as
            // a Tailwind arbitrary value, not a `.ds-*` class, so a caller's
            // `hover:border-*` still wins the cascade.
            'rounded-[var(--ds-radius-lg)] border border-[color:var(--ds-elevation-border)]',
            // Layered shadows for depth (opt-out via shadow="sm" | "none")
            SHADOW_CLASS[shadow] ?? SHADOW_CLASS.lg,
            // Smooth transitions
            'overflow-hidden transition-all duration-[var(--ds-duration-slow)]',
            // Hover effects
            hover && 'ds-hover-lift cursor-pointer',
            className
        )}>
            {children}
        </div>
    )
}
