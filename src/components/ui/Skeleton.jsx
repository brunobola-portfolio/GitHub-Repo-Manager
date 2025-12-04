import React from 'react'

export function Skeleton({ className, ...props }) {
    return (
        <div
            className={`animate-pulse rounded-md bg-slate-200 dark:bg-slate-700 ${className}`}
            {...props}
        />
    )
}
