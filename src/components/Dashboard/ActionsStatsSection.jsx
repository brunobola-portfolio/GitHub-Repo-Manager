import React from 'react'
import { motion } from 'framer-motion'
import { Zap, CheckCircle2, XCircle, Clock, TrendingUp } from 'lucide-react'
import { Card } from '../ui/Card'
import { formatNumber, formatPercentage } from '../../utils/format'

/**
 * ActionsStatsSection - GitHub Actions CI/CD statistics
 */
export function ActionsStatsSection({ stats }) {
    if (!stats) return null

    const { totalRuns, successRate, avgDuration, successCount, failureCount } = stats

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <MiniStatCard
                    icon={Zap}
                    label="Total Runs"
                    value={formatNumber(totalRuns)}
                    color="text-indigo-500"
                    bg="bg-indigo-500/10"
                />
                <MiniStatCard
                    icon={CheckCircle2}
                    label="Success Rate"
                    value={formatPercentage(successRate)}
                    color="text-emerald-500"
                    bg="bg-emerald-500/10"
                />
                <MiniStatCard
                    icon={XCircle}
                    label="Failures"
                    value={formatNumber(failureCount)}
                    color="text-red-500"
                    bg="bg-red-500/10"
                />
                <MiniStatCard
                    icon={Clock}
                    label="Avg Duration"
                    value={`${Math.round(avgDuration / 60)}m`}
                    color="text-blue-500"
                    bg="bg-blue-500/10"
                />
            </div>

            {/* Success/Failure Breakdown */}
            <Card className="p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">
                    Build Status Distribution
                </h4>
                <div className="flex gap-2 h-8 rounded-lg overflow-hidden">
                    <div
                        className="bg-emerald-500 flex items-center justify-center text-white text-xs font-bold transition-all hover:opacity-80"
                        style={{ width: `${(successCount / totalRuns) * 100}%` }}
                    >
                        {successCount > 0 && `${Math.round((successCount / totalRuns) * 100)}%`}
                    </div>
                    <div
                        className="bg-red-500 flex items-center justify-center text-white text-xs font-bold transition-all hover:opacity-80"
                        style={{ width: `${(failureCount / totalRuns) * 100}%` }}
                    >
                        {failureCount > 0 && `${Math.round((failureCount / totalRuns) * 100)}%`}
                    </div>
                </div>
            </Card>
        </div>
    )
}

function MiniStatCard({ icon: Icon, label, value, color, bg }) {
    return (
        <motion.div
            whileHover={{ y: -3 }}
            className={`p-4 rounded-xl ${bg} border border-slate-200/60 dark:border-slate-700/40`}
        >
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">
                        {label}
                    </p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                        {value}
                    </p>
                </div>
                <Icon className={`w-5 h-5 ${color}`} />
            </div>
        </motion.div>
    )
}
