import { twMerge } from 'tailwind-merge'

export function Badge({ children, variant = 'default', className }) {
    const variants = {
        // WCAG AA compliant: 4.5:1 contrast ratio for normal text
        default: 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200',
        secondary: 'bg-slate-200 dark:bg-slate-600 text-slate-900 dark:text-slate-100',
        success: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300',
        warning: 'bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-300',
        danger: 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300',
        info: 'bg-sky-100 dark:bg-sky-900/50 text-sky-900 dark:text-sky-300',
    }

    return (
        <span className={twMerge('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors', variants[variant], className)}>
            {children}
        </span>
    )
}
