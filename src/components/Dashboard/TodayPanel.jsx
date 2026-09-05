import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { EASE as MOTION_EASE, DURATION } from '../ui/motion'
import { HeroOrgChip } from './HeroOrgChip'
import { HeroTimeRangeChip } from './HeroTimeRangeChip'
import { HeroSyncChip } from './HeroSyncChip'
import { WhatNeedsYouGrid } from './WhatNeedsYouGrid'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'
import {
    getGreeting,
    getDashboardSubtitle,
    getHeroFallbackGreeting,
    getSyncedLabel,
    getDashboardLocale,
} from '../../utils/greeting'

const EASE = MOTION_EASE.emphasized

const childVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: DURATION.reveal, ease: EASE.emphasized } },
}

const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

function formatEyebrow(date, lastSyncedRelative) {
    const locale = getDashboardLocale()
    const day = date.toLocaleDateString(locale, { weekday: 'long' })
    const datePart = date.toLocaleDateString(locale, { day: '2-digit', month: 'short' })
    const synced = lastSyncedRelative ? ` · ${getSyncedLabel()} ${lastSyncedRelative}` : ''
    return `${day} · ${datePart}${synced}`.toUpperCase()
}

/**
 * TodayPanel — one cohesive top region.
 *
 * Fuses the greeting, context chips and "what needs your eyes" tiles into a
 * single panel so the dashboard opens on one statement instead of stacked
 * banners. Anchored to the shared shell ambient backdrop, so the surface
 * stays light and lets the canvas read through.
 *
 * The AI promo strip that used to live here ("Try AI insights — free") was
 * removed 2026-09-05: a signed-in, self-hosted user has no tier to upgrade
 * to, so marketing at them inside their own tool read as noise. Its one real
 * entry point (Get Insights on a repo) already lives in repo context —
 * RepoList's health badge and RepoDetail's Overview tab both open the same
 * `showRepoInsights` modal.
 */
export function TodayPanel({
    user,
    orgs,
    selectedOrg,
    onSelectOrg,
    loading,
    timeRange,
    onTimeRangeChange,
    onSync,
    lastSyncedAt,
    onOpenWorkBoard,
}) {
    const now = useMemo(() => new Date(), [])
    const lastSyncedRelative = useRelativeTime(lastSyncedAt)
    const greeting = user ? getGreeting(now, user.name || user.login) : getHeroFallbackGreeting()
    const eyebrow = formatEyebrow(now, lastSyncedRelative)

    return (
        <motion.section
            id="today"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            aria-label="Dashboard hero"
            className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-200/60 dark:border-slate-800/70 bg-white/70 dark:bg-slate-900/55 backdrop-blur-sm ds-elevation-sm"
        >
            {/* Spine node — same visual anchor as CategorySection so Today
                reads as the first stop on the dashboard thread. */}
            <span
                aria-hidden="true"
                className="hidden lg:block absolute -left-[21px] top-[42px] w-1.5 h-1.5 rounded-full bg-brand-400 dark:bg-brand-500 ring-4 ring-white/60 dark:ring-slate-950/60"
            />
            {/* Internal soft highlight — premium glaze without rainbow gradients. */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                    background:
                        'radial-gradient(120% 60% at 0% 0%, color-mix(in srgb, var(--ds-accent-brand) 10%, transparent), transparent 55%)',
                }}
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-slate-700 to-transparent"
            />

            <div className="relative p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0 space-y-2.5">
                        <motion.p
                            variants={childVariants}
                            className="ds-eyebrow text-slate-500 dark:text-slate-400"
                        >
                            {eyebrow}
                        </motion.p>
                        <motion.h1
                            variants={childVariants}
                            className="text-xl sm:text-2xl lg:text-[1.7rem] font-semibold tracking-tight ds-font-display text-slate-900 dark:text-slate-100"
                        >
                            {greeting}
                        </motion.h1>
                        <motion.p
                            variants={childVariants}
                            className="text-sm text-slate-500 dark:text-slate-400 max-w-prose"
                        >
                            {getDashboardSubtitle()}
                        </motion.p>
                    </div>

                    <motion.div
                        variants={childVariants}
                        className="flex flex-wrap items-center gap-2 lg:justify-end lg:shrink-0"
                    >
                        <HeroOrgChip
                            orgs={orgs}
                            selectedOrg={selectedOrg}
                            onSelectOrg={onSelectOrg}
                            loading={loading}
                        />
                        <HeroTimeRangeChip value={timeRange} onChange={onTimeRangeChange} />
                        <HeroSyncChip onSync={onSync} lastSyncedAt={lastSyncedAt} />
                    </motion.div>
                </div>

                <motion.div variants={childVariants}>
                    <WhatNeedsYouGrid onOpenWorkBoard={onOpenWorkBoard} />
                </motion.div>
            </div>
        </motion.section>
    )
}
