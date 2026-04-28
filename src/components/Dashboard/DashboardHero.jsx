import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { HeroOrgChip } from './HeroOrgChip'
import { HeroTimeRangeChip } from './HeroTimeRangeChip'
import { HeroSyncChip } from './HeroSyncChip'
import { WhatNeedsYouGrid } from './WhatNeedsYouGrid'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'
import { getGreeting } from '../../utils/greeting'

const EASE = [0.16, 1, 0.3, 1]

const childVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
}

const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
}

function formatEyebrow(date, lastSyncedRelative) {
    const day = date.toLocaleDateString('pt-PT', { weekday: 'long' })
    const datePart = date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })
    const synced = lastSyncedRelative ? ` · sincronizado ${lastSyncedRelative}` : ''
    return `${day} · ${datePart}${synced}`.toUpperCase()
}

export function DashboardHero({
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
    const greeting = user ? getGreeting(now, user.name || user.login) : 'Olá ✨'
    const eyebrow = formatEyebrow(now, lastSyncedRelative)

    return (
        <motion.section
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-5"
            aria-label="Dashboard hero"
        >
            <motion.p
                variants={childVariants}
                className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300"
            >
                {eyebrow}
            </motion.p>

            <motion.h1
                variants={childVariants}
                className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight ds-font-display ds-gradient-text"
            >
                {greeting}
            </motion.h1>

            <motion.p variants={childVariants} className="text-sm text-slate-500 dark:text-slate-400">
                Aqui está o que precisa de ti hoje.
            </motion.p>

            <motion.div variants={childVariants} className="flex flex-wrap items-center gap-2">
                <HeroOrgChip
                    orgs={orgs}
                    selectedOrg={selectedOrg}
                    onSelectOrg={onSelectOrg}
                    loading={loading}
                />
                <HeroTimeRangeChip value={timeRange} onChange={onTimeRangeChange} />
                <HeroSyncChip onSync={onSync} lastSyncedAt={lastSyncedAt} />
            </motion.div>

            <motion.div variants={childVariants}>
                <WhatNeedsYouGrid onOpenWorkBoard={onOpenWorkBoard} />
            </motion.div>
        </motion.section>
    )
}
