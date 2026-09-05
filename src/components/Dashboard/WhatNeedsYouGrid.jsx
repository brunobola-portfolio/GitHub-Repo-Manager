import { motion } from 'framer-motion'
import { EASE, DURATION } from '../ui/motion'
import { GitPullRequest, Clock, CircleDot, Sparkles, ArrowRight, ArrowUp, ArrowDown, AlertCircle } from 'lucide-react'
import { useYourWork } from '../../hooks/useYourWork'
import { Skeleton } from '../ui/Skeleton'

const CATEGORIES = [
    {
        id: 'reviews',
        label: 'Reviews waiting',
        tab: 'reviews',
        icon: GitPullRequest,
        tone: 'brand',
    },
    {
        id: 'stale',
        label: 'Stale PRs',
        tab: 'stale',
        icon: Clock,
        tone: 'attention',
    },
    {
        id: 'issues',
        label: 'Issues for you',
        tab: 'issues',
        icon: CircleDot,
        tone: 'brand',
    },
]

// Two tones, and the count is never one of them.
//
// These tiles were indigo / amber / emerald: three hues for three categories
// that differ by icon and label already. Worse, the count inherited the tone,
// so "Reviews waiting: 5" rendered in green and "Issues for you: 3" in
// emerald — the product's own colour for a passing check, on the two numbers
// that mean the opposite. A count is a quantity; it reads in the foreground
// colour. Only the genuinely-overdue category keeps a warning tone.
const TONE_CLASSES = {
    brand: {
        iconBg: 'bg-brand-500/10',
        iconColor: 'text-brand-600 dark:text-brand-300',
        countActive: 'text-slate-900 dark:text-slate-50',
        hoverBorder: 'hover:border-brand-300 dark:hover:border-brand-500/50',
        ring: 'focus-visible:ring-brand-500',
    },
    attention: {
        iconBg: 'bg-amber-500/10',
        iconColor: 'text-amber-700 dark:text-amber-400',
        countActive: 'text-amber-700 dark:text-amber-400',
        hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-500/50',
        ring: 'focus-visible:ring-amber-500',
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
            <div className="ds-eyebrow text-slate-500 dark:text-slate-400">
                {category.label}
            </div>
            <div className="flex items-end justify-between gap-2">
                <span className={`text-2xl font-semibold ds-font-display ${hasCount ? tone.countActive : 'text-slate-400 dark:text-slate-600'}`}>
                    {data.count}
                </span>
                {showDelta && (
                    <span
                        className={`inline-flex items-center gap-0.5 text-xs font-semibold ${delta > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}
                        aria-label={`${Math.abs(delta)} ${delta > 0 ? 'more than' : 'fewer than'} previous`}
                    >
                        {delta > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                        {Math.abs(delta)}
                    </span>
                )}
            </div>
            {showDelta && (
                <div className="ds-text-micro text-slate-500 dark:text-slate-400">{deltaContext(data.baselineAt)}</div>
            )}
            <div className="text-xs font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
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
            transition={{ duration: DURATION.reveal, ease: EASE.emphasized }}
            className="col-span-2 sm:col-span-3 flex flex-col items-center text-center gap-2 py-5 px-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl"
        >
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 ds-font-display">You're all caught up.</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing needs you right now.</p>
            <button
                type="button"
                onClick={() => onOpenWorkBoard?.({})}
                className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
            >
                Open Work Board <ArrowRight className="w-3.5 h-3.5" />
            </button>
        </motion.div>
    )
}

// Reached when at least one source could not be read. The grid's whole output
// is a sum, so a partial answer cannot be presented as a complete one — and
// the specific complete answer it used to give ("nothing needs you") is the
// one a user acts on by closing the tab.
function CouldNotCheck({ onRetry }) {
    return (
        <motion.div
            role="status"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: DURATION.reveal, ease: EASE.emphasized }}
            className="col-span-2 sm:col-span-3 flex flex-col items-center text-center gap-2 py-5 px-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl"
        >
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 ds-font-display">Couldn&rsquo;t check your work</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
                Couldn&rsquo;t reach GitHub just now, so this may be out of date. Nothing has changed on your side.
            </p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
            >
                Try again <ArrowRight className="w-3.5 h-3.5" />
            </button>
        </motion.div>
    )
}

export function WhatNeedsYouGrid({ onOpenWorkBoard }) {
    const { status, hidden, reviews, stale, issues, refresh } = useYourWork()

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

    if (status === 'error') {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
                <CouldNotCheck onRetry={refresh} />
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
