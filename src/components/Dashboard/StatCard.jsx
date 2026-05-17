import { memo } from 'react'
import { motion } from 'framer-motion'
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
    color = "text-indigo-500",
    bg = "bg-indigo-500/10",
    trend,
    loading = false,
    compact = false,
    onClick,
    hint,
}) {
    if (loading) {
        return <Skeleton className="h-32 rounded-2xl" />
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
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            className="rounded-2xl focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-inset"
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${title}${hint ? ` — ${hint}` : ''}` : undefined}
            onClick={interactive ? onClick : undefined}
            onKeyDown={interactive ? handleKeyDown : undefined}
            title={interactive && hint ? hint : undefined}
            style={interactive ? { cursor: 'pointer' } : undefined}
        >
            <Card className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all duration-300 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 group">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <p className="text-xs sm:text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider ds-font-display">
                            {title}
                        </p>
                        <motion.h3
                            className="text-xl sm:text-3xl font-semibold text-slate-900 dark:text-white mt-2 sm:mt-3 ds-font-mono"
                            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
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
                            <p className="mt-3 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100 transition-opacity flex items-center gap-1">
                                {hint}
                                <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                            </p>
                        )}
                    </div>
                    <div className={`p-2.5 sm:p-4 rounded-xl sm:rounded-2xl ${bg}`}>
                        <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${color}`} />
                    </div>
                </div>
            </Card>
        </motion.div>
    )
})
