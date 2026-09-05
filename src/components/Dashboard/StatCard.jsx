import { memo } from 'react'
import { motion } from 'framer-motion'
import { EASE, DURATION } from '../ui/motion'
import { ArrowUpRight } from 'lucide-react'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { CountUp } from '../ui/CountUp'
import { formatNumber, formatCompact } from '../../utils/format'

/**
 * StatCard - Animated metric card with icon and optional trend.
 *
 * When `onClick` is provided, the card becomes a fully-interactive button:
 * focusable, keyboard-activatable (Enter/Space), with a hover hint shown via
 * the existing `title` attribute (so it works on touch via long-press too)
 * plus a small bottom-aligned "{hint} →" line that fades in on hover. Cards
 * without `onClick` render the exact same DOM as before — no regression.
 */
export const StatCard = memo(function StatCard({
    title,
    value,
    icon: Icon,
    // color and bg props are accepted for backward-compat but ignored in the
    // render path — all stat cards now use a uniform neutral icon treatment.
    color: _color,
    bg: _bg,
    trend,
    loading = false,
    compact = false,
    onClick,
    hint,
}) {
    if (loading) {
        return <Skeleton className="h-full min-h-32 rounded-2xl" />
    }

    const isNumeric = typeof value === 'number'
    const formatFn = compact ? formatCompact : formatNumber
    const formattedValue = isNumeric ? formatFn(value) : value

    const interactive = typeof onClick === 'function'
    const handleKeyDown = (e) => {
        if (!interactive) return
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
        }
    }

    return (
        <motion.div
            transition={{ duration: DURATION.standard, ease: EASE.standard }}
            /* h-full both here and on the Card: the grid stretches this
               wrapper, but a Card that sizes to its own content leaves the
               shorter tiles floating with a gap under them. One card whose
               hint wraps to a second line used to make the whole row ragged. */
            className="h-full rounded-2xl ds-focus-ring"
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${title}${hint ? ` — ${hint}` : ''}` : undefined}
            onClick={interactive ? onClick : undefined}
            onKeyDown={interactive ? handleKeyDown : undefined}
            title={interactive && hint ? hint : undefined}
            style={interactive ? { cursor: 'pointer' } : undefined}
        >
            <Card className="h-full flex flex-col p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all duration-[var(--ds-duration)] border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 group">
                <div className="flex flex-1 items-start justify-between">
                    <div className="flex-1">
                        <p className="ds-eyebrow text-slate-500 dark:text-slate-400 ds-font-display">
                            {title}
                        </p>
                        <motion.h3
                            className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-2 ds-font-mono"
                            transition={{ duration: DURATION.standard, ease: EASE.standard }}
                        >
                            {isNumeric ? (
                                <CountUp value={value} format={formatFn} />
                            ) : (
                                formattedValue
                            )}
                        </motion.h3>
                        {trend && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 flex items-center gap-1.5 font-medium">
                                {trend}
                            </p>
                        )}
                        {interactive && hint && (
                            <p className="mt-3 ds-text-meta font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100 transition-opacity flex items-center gap-1">
                                {hint}
                                <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                            </p>
                        )}
                    </div>
                    <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800">
                        <Icon className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                    </div>
                </div>
            </Card>
        </motion.div>
    )
})
