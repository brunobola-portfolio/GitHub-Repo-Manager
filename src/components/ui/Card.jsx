import { twMerge } from 'tailwind-merge'

export function Card({ children, className, hover = false, glass = true, ref, ...props }) {
    return (
        <div ref={ref} {...props} className={twMerge(
            // Base glassmorphism styling
            glass
                ? 'bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl'
                : 'bg-white dark:bg-slate-800',
            // Borders with subtle transparency
            'rounded-2xl border border-slate-200/70 dark:border-slate-700/50',
            // Layered shadows for depth
            'shadow-lg shadow-slate-200/40 dark:shadow-black/40',
            // Smooth transitions
            'overflow-hidden transition-all duration-300',
            // Hover effects
            hover && 'hover:shadow-xl hover:shadow-slate-300/50 dark:hover:shadow-black/60 hover:border-slate-300/80 dark:hover:border-slate-600/60 hover:-translate-y-1',
            className
        )}>
            {children}
        </div>
    )
}
