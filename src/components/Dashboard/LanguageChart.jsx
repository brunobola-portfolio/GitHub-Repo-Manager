import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip } from 'recharts'
import { Code2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { motion } from 'framer-motion'
import { useMeasuredSize } from '../../hooks/useMeasuredSize'

// GitHub-style language colors — covers the most common languages
const LANGUAGE_COLORS = {
    JavaScript: '#f1e05a',
    TypeScript: '#3178c6',
    Python: '#3572A5',
    Java: '#b07219',
    'C#': '#178600',
    'C++': '#f34b7d',
    C: '#555555',
    Go: '#00ADD8',
    Rust: '#dea584',
    Ruby: '#701516',
    PHP: '#4F5D95',
    Swift: '#F05138',
    Kotlin: '#A97BFF',
    Dart: '#00B4AB',
    Scala: '#c22d40',
    R: '#198CE7',
    Shell: '#89e051',
    Lua: '#000080',
    Perl: '#0298c3',
    Haskell: '#5e5086',
    Elixir: '#6e4a7e',
    Clojure: '#db5855',
    Erlang: '#B83998',
    Julia: '#a270ba',
    HTML: '#e34c26',
    CSS: '#563d7c',
    SCSS: '#c6538c',
    Vue: '#41b883',
    Svelte: '#ff3e00',
    Jupyter: '#DA5B0B',
    Dockerfile: '#384d54',
    HCL: '#844FBA',
    Nix: '#7e7eff',
    Zig: '#ec915c',
    OCaml: '#3be133',
    'Objective-C': '#438eff',
    Groovy: '#4298b8',
    PowerShell: '#012456',
    Vim: '#199f4b',
}

// Vibrant fallback palette for languages not in the map
const FALLBACK_COLORS = [
    '#6366f1', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b',
    '#ef4444', '#06b6d4', '#10b981', '#f97316', '#84cc16',
    '#e879f9', '#22d3ee', '#fb923c', '#a78bfa', '#34d399',
    '#fbbf24', '#f472b6', '#2dd4bf', '#c084fc', '#4ade80',
]

function getLanguageColor(name, index) {
    return LANGUAGE_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

/**
 * LanguageChart - Pie chart showing language distribution
 */
export function LanguageChart({ data = [], loading }) {
    // Enrich data with colors and percentages
    const enrichedData = useMemo(() => {
        const total = data.reduce((sum, d) => sum + d.value, 0)
        return data.map((item, i) => ({
            ...item,
            color: item.color || getLanguageColor(item.name, i),
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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
        >
            <Card
                className="p-4 sm:p-6 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-[var(--ds-duration)]"
                style={{ minHeight: `${chartHeight + 60}px` }}
            >
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-6 flex items-center gap-2">
                    <Code2 className="w-5 h-5 text-pink-500" />
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
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
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
                                            <span className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate flex-1 min-w-0">
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
                                    <span className="text-xs text-slate-700 dark:text-slate-300 font-medium truncate flex-1 min-w-0">
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
