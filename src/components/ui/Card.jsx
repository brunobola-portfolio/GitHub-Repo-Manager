import { twMerge } from 'tailwind-merge'

const SHADOW_CLASS = {
    lg: 'shadow-lg shadow-slate-200/40 dark:shadow-black/40',
    sm: 'shadow-sm dark:shadow-black/30',
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
            // Borders
            'rounded-[var(--ds-radius-lg)] border border-slate-200 dark:border-slate-700',
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
