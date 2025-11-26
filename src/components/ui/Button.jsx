import { twMerge } from 'tailwind-merge'

const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 dark:shadow-indigo-900/50 active:scale-[0.98]',
    secondary: 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-600 shadow-sm active:scale-[0.98]',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-200 dark:shadow-red-900/50 active:scale-[0.98]',
    warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm shadow-amber-200 dark:shadow-amber-900/50 active:scale-[0.98]',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-200 dark:shadow-emerald-900/50 active:scale-[0.98]',
    info: 'bg-sky-500 text-white hover:bg-sky-600 shadow-sm shadow-sky-200 dark:shadow-sky-900/50 active:scale-[0.98]',
    ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
}

const sizes = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-6 py-3 text-base gap-2.5',
}

export function Button({ className, variant = 'primary', size = 'md', children, ...props }) {
    return (
        <button
            className={twMerge(
                'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
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
