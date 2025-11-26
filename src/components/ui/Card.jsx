import { twMerge } from 'tailwind-merge'

export function Card({ children, className, hover = false }) {
    return (
        <div className={twMerge(
            'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/20 overflow-hidden transition-all duration-200',
            hover && 'hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 hover:-translate-y-0.5',
            className
        )}>
            {children}
        </div>
    )
}
