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
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            whileHover={{ y: -6, scale: 1.02 }}
        >
            <Card className="p-6 h-[420px] bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 shadow-xl hover:shadow-2xl hover:border-pink-400/50 dark:hover:border-pink-500/40 transition-all duration-300 cursor-pointer">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-8 flex items-center gap-2">
                    <Code2 className="w-5 h-5 text-pink-500" />
                    Language Distribution
                </h3>
                {loading ? (
                    <div className="flex items-center justify-center h-[300px]">
                        <Skeleton className="w-64 h-64 rounded-full" />
                    </div>
                ) : data.length === 0 ? (
                    <div className="flex items-center justify-center h-[300px] text-slate-400 dark:text-slate-500">
                        <p>No language data available</p>
                    </div>
                ) : (
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%" debounce={50}>
                            <PieChart>
                                <Pie
                                    data={data}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={80}
                                    outerRadius={120}
                                    paddingAngle={5}
                                    dataKey="value"
                                    cornerRadius={6}
                                >
                                    {data.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
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

                        {/* Language Legend */}
                        <div className="grid grid-cols-2 gap-3 mt-6">
                            {data.slice(0, 6).map((lang, idx) => (
                                <div key={lang.name} className="flex items-center gap-2">
                                    <div
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                                    />
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                                        {lang.name}
                                    </span>
                                    <span className="text-xs text-slate-400 ml-auto">
                                        {lang.value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Card>
        </motion.div>
    )
}
