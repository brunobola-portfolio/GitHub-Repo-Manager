import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip } from 'recharts'
import { Code2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { motion } from 'framer-motion'
import { useMeasuredSize } from '../../hooks/useMeasuredSize'
import { getLanguageColor } from '../../utils/languageColors'
import { DURATION } from '../ui/motion'

/**
 * LanguageChart - Pie chart showing language distribution
 */
export function LanguageChart({ data = [], loading }) {
    // Enrich data with colors and percentages
    const enrichedData = useMemo(() => {
        const total = data.reduce((sum, d) => sum + d.value, 0)
        return data.map((item) => ({
            ...item,
            color: item.color || getLanguageColor(item.name),
            percentage: total > 0 ? ((item.value / total) * 100).toFixed(1) : 0,
        }))
    }, [data])

    // Calculate dynamic sizes based on data length
    const itemsPerColumn = Math.ceil(enrichedData.length / 2)
    const legendHeight = Math.max(itemsPerColumn * 32, 200)
    const chartHeight = Math.max(legendHeight + 60, 340)
    // Hand recharts concrete pixel dimensions instead of ResponsiveContainer.
    // ResponsiveContainer initializes width/height to -1 and renders the
    // PieChart with that sentinel before its first ResizeObserver pass,
    // tripping recharts' own width(-1)/height(-1) warning. Real numbers from
    // useMeasuredSize sidestep the sentinel entirely.
    const [pieRef, { width: pieMeasuredW, height: pieMeasuredH }] = useMeasuredSize()
    const pieReady = pieMeasuredW > 0 && pieMeasuredH > 0

    return (
        <motion.div
            className="h-full"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.gentle, delay: 0.1 }}
        >
            <Card
                className="h-full"
                /* Border + shadow come from Card's --ds-elevation-* defaults —
                   the local `border-slate-200 shadow-sm` override used to win
                   through twMerge and reinstated the flat light-mode card. */
                className="p-4 sm:p-6 transition-all duration-[var(--ds-duration)]"
                style={{ minHeight: `${chartHeight + 60}px` }}
            >
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-6 flex items-center gap-2">
                    <Code2 className="w-5 h-5 text-brand-500" />
                    Language Distribution
                </h3>
                {loading ? (
                    <div className="flex items-center justify-center" style={{ height: `${chartHeight}px` }}>
                        <Skeleton className="w-64 h-64 rounded-full" />
                    </div>
                ) : enrichedData.length === 0 ? (
                    <div className="flex items-center justify-center text-slate-500 dark:text-slate-400" style={{ height: `${chartHeight}px` }}>
                        <p>No language data available</p>
                    </div>
                ) : (
                    <>
                        {/* Compact horizontal stacked bar — sub-sm only (slice 5 row 4) */}
                        <div
                            data-testid="language-chart-bar"
                            className="sm:hidden mb-4"
                            role="img"
                            aria-label={`Language distribution: ${enrichedData.map((l) => `${l.name} ${l.percentage}%`).join(', ')}`}
                        >
                            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200/60 dark:bg-slate-700/60">
                                {enrichedData.map((lang) => (
                                    <div
                                        key={`bar-${lang.name}`}
                                        style={{ width: `${lang.percentage}%`, backgroundColor: lang.color }}
                                        title={`${lang.name} — ${lang.percentage}%`}
                                    />
                                ))}
                            </div>
                        </div>

                        <div
                            data-testid="language-chart-pie"
                            className="hidden sm:flex flex-col xl:flex-row items-center gap-4 sm:gap-8"
                            style={{ minHeight: `${chartHeight}px` }}
                        >
                            {/* Chart */}
                            <div
                                ref={pieRef}
                                style={{ maxWidth: '280px', width: '100%', height: '280px', overflow: 'hidden' }}
                            >
                                {pieReady && (
                                <PieChart width={pieMeasuredW} height={pieMeasuredH}>
                                        <Pie
                                            data={enrichedData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={85}
                                            outerRadius={130}
                                            paddingAngle={3}
                                            dataKey="value"
                                            cornerRadius={8}
                                        >
                                            {enrichedData.map((entry, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={entry.color}
                                                    strokeWidth={0}
                                                    className="transition-opacity hover:opacity-80"
                                                />
                                            ))}
                                        </Pie>
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'var(--ds-chart-tooltip-bg)',
                                            backdropFilter: 'blur(16px)',
                                            border: '1px solid var(--ds-chart-tooltip-border)',
                                            borderRadius: '16px',
                                            boxShadow: 'var(--ds-chart-tooltip-shadow)',
                                            padding: '12px 16px',
                                        }}
                                        itemStyle={{
                                            color: 'var(--ds-chart-tooltip-text)',
                                            fontSize: '13px',
                                            fontWeight: '500',
                                        }}
                                    />
                                </PieChart>
                                )}
                            </div>

                            {/* Language Legend - Dynamic and scrollable */}
                            <div className="flex-1 w-full xl:w-auto overflow-y-auto max-h-[340px] ds-scrollbar pr-2">
                                <div
                                    className="grid gap-3"
                                    style={{
                                        // 150px→220px: at 150 a single word like "TypeScript" or
                                        // "JavaScript" truncated mid-word inside a card with
                                        // hundreds of px of unused width (U29) — the column
                                        // needed room, not an ellipsis.
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                                        gridAutoRows: 'minmax(0, auto)'
                                    }}
                                >
                                    {enrichedData.map((lang) => (
                                        <div
                                            key={lang.name}
                                            className="flex items-center gap-3 group p-2.5 rounded-xl transition-all duration-200"
                                        >
                                            <div
                                                className="w-4 h-4 rounded-md flex-shrink-0 shadow-sm ring-1 ring-black/5 dark:ring-white/10 transition-colors"
                                                style={{ backgroundColor: lang.color }}
                                            />
                                            <span className="text-sm text-slate-700 dark:text-slate-300 font-medium flex-1 min-w-0">
                                                {lang.name}
                                            </span>
                                            <div className="flex items-center gap-2 text-xs flex-shrink-0">
                                                <span className="text-slate-600 dark:text-slate-400 font-semibold">
                                                    {lang.value}
                                                </span>
                                                <span className="text-slate-500 dark:text-slate-400 font-medium">
                                                    {lang.percentage}%
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Compact legend list — sub-sm, paired with the stacked bar above */}
                        <div className="sm:hidden grid grid-cols-2 gap-2">
                            {enrichedData.map((lang) => (
                                <div key={`legend-${lang.name}`} className="flex items-center gap-2 min-w-0">
                                    <span
                                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                        style={{ backgroundColor: lang.color }}
                                    />
                                    <span className="text-xs text-slate-700 dark:text-slate-300 font-medium flex-1 min-w-0">
                                        {lang.name}
                                    </span>
                                    <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
                                        {lang.percentage}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Card>
        </motion.div>
    )
}
