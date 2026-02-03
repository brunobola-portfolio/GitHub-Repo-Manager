import { twMerge } from 'tailwind-merge'

export function Badge({ children, variant = 'default', className }) {
    const variants = {
        default: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
        secondary: 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-200',
        success: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400',
        warning: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400',
        danger: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400',
        info: 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-400',
    }

    return (
        <span className={twMerge('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors', variants[variant], className)}>
            {children}
        </span>
    )
}
