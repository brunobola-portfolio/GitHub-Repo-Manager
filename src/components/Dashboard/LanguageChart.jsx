import React from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Code2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { motion } from 'framer-motion'

const COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444']

/**
 * LanguageChart - Pie chart showing language distribution
 */
export function LanguageChart({ data = [], loading }) {
    // Calculate dynamic sizes based on data length
    const itemsPerColumn = Math.ceil(data.length / 2)
    const legendHeight = Math.max(itemsPerColumn * 32, 200)
    const chartHeight = Math.max(legendHeight + 60, 340)

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            whileHover={{ y: -6, scale: 1.02 }}
        >
            <Card
                className="p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 shadow-xl hover:shadow-2xl hover:border-pink-400/50 dark:hover:border-pink-500/40 transition-all duration-300 cursor-pointer"
                style={{ minHeight: `${chartHeight + 60}px` }}
            >
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                    <Code2 className="w-5 h-5 text-pink-500" />
                    Language Distribution
                </h3>
                {loading ? (
                    <div className="flex items-center justify-center" style={{ height: `${chartHeight}px` }}>
                        <Skeleton className="w-64 h-64 rounded-full" />
                    </div>
                ) : data.length === 0 ? (
                    <div className="flex items-center justify-center text-slate-400 dark:text-slate-500" style={{ height: `${chartHeight}px` }}>
                        <p>No language data available</p>
                    </div>
                ) : (
                    <div className="flex flex-col lg:flex-row items-center gap-8" style={{ minHeight: `${chartHeight}px` }}>
                        {/* Chart */}
                        <div style={{ maxWidth: '280px', width: '100%', height: '280px' }}>
                            <ResponsiveContainer width="100%" height="100%" debounce={50}>
                                <PieChart>
                                    <Pie
                                        data={data}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={85}
                                        outerRadius={130}
                                        paddingAngle={3}
                                        dataKey="value"
                                        cornerRadius={8}
                                    >
                                        {data.map((entry, index) => (
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
                                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                                        backdropFilter: 'blur(16px)',
                                        border: '1px solid rgba(148, 163, 184, 0.2)',
                                        borderRadius: '16px',
                                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                                        padding: '12px 16px',
                                    }}
                                    itemStyle={{
                                        color: '#f8fafc',
                                        fontSize: '13px',
                                        fontWeight: '500',
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        </div>

                        {/* Language Legend - Dynamic and scrollable */}
                        <div className="flex-1 w-full lg:w-auto overflow-y-auto max-h-[340px] custom-scrollbar pr-2">
                            <div
                                className="grid gap-3"
                                style={{
                                    gridTemplateColumns: data.length > 8 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
                                    gridAutoRows: 'minmax(0, auto)'
                                }}
                            >
                                {data.map((lang, index) => (
                                    <div
                                        key={lang.name}
                                        className="flex items-center gap-3 group hover:bg-slate-50/80 dark:hover:bg-slate-800/40 p-2.5 rounded-xl transition-all duration-200 cursor-pointer"
                                    >
                                        <div
                                            className="w-4 h-4 rounded-md flex-shrink-0 shadow-sm group-hover:scale-110 transition-transform"
                                            style={{ backgroundColor: lang.color }}
                                        />
                                        <span className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate flex-1 min-w-0">
                                            {lang.name}
                                        </span>
                                        <div className="flex items-center gap-2 text-xs flex-shrink-0">
                                            <span className="text-slate-600 dark:text-slate-400 font-semibold">
                                                {lang.value}
                                            </span>
                                            <span className="text-slate-400 dark:text-slate-500 font-medium">
                                                {lang.percentage}%
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </Card>
        </motion.div>
    )
}
