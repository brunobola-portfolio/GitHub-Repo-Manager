import { motion } from 'framer-motion'
import { GitPullRequest, Clock, CircleDot, Sparkles, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react'
import { useYourWork } from '../../hooks/useYourWork'
import { Skeleton } from '../ui/Skeleton'

const CATEGORIES = [
    {
        id: 'reviews',
        label: 'Reviews waiting',
        tab: 'reviews',
        icon: GitPullRequest,
        tone: 'indigo',
    },
    {
        id: 'stale',
        label: 'Stale PRs',
        tab: 'stale',
        icon: Clock,
        tone: 'amber',
    },
    {
        id: 'issues',
        label: 'Issues for you',
        tab: 'issues',
        icon: CircleDot,
        tone: 'emerald',
    },
]

const TONE_CLASSES = {
    indigo: {
        iconBg: 'bg-indigo-500/10',
        iconColor: 'text-indigo-500',
        countActive: 'text-indigo-600 dark:text-indigo-400',
        hoverBorder: 'hover:border-indigo-300 dark:hover:border-indigo-500/50',
        ring: 'focus-visible:ring-indigo-500',
    },
    amber: {
        iconBg: 'bg-amber-500/10',
        iconColor: 'text-amber-500',
        countActive: 'text-amber-600 dark:text-amber-400',
        hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-500/50',
        ring: 'focus-visible:ring-amber-500',
    },
    emerald: {
        iconBg: 'bg-emerald-500/10',
        iconColor: 'text-emerald-500',
        countActive: 'text-emerald-600 dark:text-emerald-400',
        hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-500/50',
        ring: 'focus-visible:ring-emerald-500',
    },
}

function deltaContext(baselineAt) {
    if (!baselineAt) return null
    const ms = Date.now() - baselineAt
    if (ms < 3_600_000) return 'just now'
    if (ms < 86_400_000) return 'earlier today'
    return 'since yesterday'
}

function CategoryCard({ category, data, onClick }) {
    const Icon = category.icon
    const tone = TONE_CLASSES[category.tone]
    const hasCount = data.count > 0
    const delta = data.delta
    const showDelta = delta !== null && delta !== 0
    const ariaLabel = `${data.count} ${category.label.toLowerCase()}, opens Work Board ${category.tab} tab`

    const lastClass = category.id === 'issues' ? 'col-span-2 sm:col-span-1' : ''

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className={`group flex flex-col gap-2.5 p-4 text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl ${tone.hoverBorder} hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${tone.ring} transition-all ${lastClass}`}
        >
            <div className={`w-8 h-8 rounded-lg ${tone.iconBg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${tone.iconColor}`} />
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {category.label}
            </div>
            <div className="flex items-end justify-between gap-2">
                <span className={`text-2xl font-semibold ds-font-display ${hasCount ? tone.countActive : 'text-slate-400 dark:text-slate-600'}`}>
                    {data.count}
                </span>
                {showDelta && (
                    <span
                        className={`inline-flex items-center gap-0.5 text-xs font-semibold ${delta > 0 ? 'text-emerald-500' : 'text-rose-500'}`}
                        aria-label={`${Math.abs(delta)} ${delta > 0 ? 'more than' : 'fewer than'} previous`}
                    >
                        {delta > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                        {Math.abs(delta)}
                    </span>
                )}
            </div>
            {showDelta && (
                <div className="text-[10px] text-slate-400 dark:text-slate-500">{deltaContext(data.baselineAt)}</div>
            )}
            <div className="text-xs font-medium text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                Open <ArrowRight className="w-3 h-3" />
            </div>
        </button>
    )
}

function SkeletonCard() {
    return (
        <div data-testid="skeleton-card" className="flex flex-col gap-2.5 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-12" />
        </div>
    )
}

function EmptyState({ onOpenWorkBoard }) {
    return (
        <motion.div
            role="status"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="col-span-2 sm:col-span-3 flex flex-col items-center text-center gap-2 py-5 px-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl"
        >
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 ds-font-display">Estás em dia.</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Nada precisa de ti agora.</p>
            <button
                type="button"
                onClick={() => onOpenWorkBoard?.({})}
                className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
                Open Work Board <ArrowRight className="w-3.5 h-3.5" />
            </button>
        </motion.div>
    )
}

export function WhatNeedsYouGrid({ onOpenWorkBoard }) {
    const { status, hidden, reviews, stale, issues } = useYourWork()

    if (hidden) return null

    if (status === 'loading') {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
            </div>
        )
    }

    const total = reviews.count + stale.count + issues.count

    if (total === 0) {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
                <EmptyState onOpenWorkBoard={onOpenWorkBoard} />
            </div>
        )
    }

    const dataMap = { reviews, stale, issues }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
            {CATEGORIES.map(category => (
                <CategoryCard
                    key={category.id}
                    category={category}
                    data={dataMap[category.id]}
                    onClick={() => onOpenWorkBoard?.({ initialTab: category.tab })}
                />
            ))}
        </div>
    )
}
