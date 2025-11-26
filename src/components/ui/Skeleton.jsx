import { twMerge } from 'tailwind-merge'

/**
 * Base skeleton component with shimmer animation
 */
export function Skeleton({ className, ...props }) {
    return (
        <div
            className={twMerge(
                'animate-pulse rounded-md bg-slate-200 dark:bg-slate-700',
                className
            )}
            {...props}
        />
    )
}

/**
 * Skeleton for table rows
 */
export function TableRowSkeleton({ columns = 5 }) {
    return (
        <tr className="border-b border-slate-100 dark:border-slate-700">
            {Array.from({ length: columns }).map((_, i) => (
                <td key={i} className="px-4 py-3">
                    <Skeleton className="h-4 w-full max-w-[200px]" />
                </td>
            ))}
        </tr>
    )
}

/**
 * Skeleton for the repository list
 */
export function RepoListSkeleton({ rows = 5 }) {
    return (
        <div className="space-y-0">
            {Array.from({ length: rows }).map((_, i) => (
                <div
                    key={i}
                    className="flex items-center gap-4 px-4 py-3 border-b border-slate-100 dark:border-slate-700"
                >
                    <Skeleton className="h-4 w-4" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-8 w-20 rounded-md" />
                </div>
            ))}
        </div>
    )
}

/**
 * Skeleton for stat cards
 */
export function StatCardSkeleton() {
    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="space-y-2 flex-1">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-6 w-12" />
                </div>
            </div>
        </div>
    )
}

/**
 * Skeleton for dashboard stats grid
 */
export function DashboardSkeleton() {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
                <StatCardSkeleton key={i} />
            ))}
        </div>
    )
}

/**
 * Skeleton for organization card
 */
export function OrgCardSkeleton() {
    return (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
            </div>
        </div>
    )
}

/**
 * Full page loading skeleton
 */
export function PageSkeleton() {
    return (
        <div className="space-y-6 p-6">
            <DashboardSkeleton />
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-4">
                        <Skeleton className="h-9 w-48" />
                        <Skeleton className="h-9 w-24" />
                        <Skeleton className="h-9 w-24" />
                    </div>
                </div>
                <RepoListSkeleton rows={5} />
            </div>
        </div>
    )
}

export default Skeleton

