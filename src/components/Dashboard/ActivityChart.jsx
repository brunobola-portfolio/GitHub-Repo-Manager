import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Activity } from 'lucide-react'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { motion } from 'framer-motion'
import { useMeasuredSize } from '../../hooks/useMeasuredSize'

/**
 * ActivityChart - Timeline chart showing commits, PRs, and issues
 */
export function ActivityChart({ activity = [], timeRange, loading }) {
    const chartData = useMemo(() => {
        if (!activity || activity.length === 0) {
            return [
                { name: 'Mon', commits: 4, pulls: 2, issues: 1 },
                { name: 'Tue', commits: 7, pulls: 3, issues: 2 },
                { name: 'Wed', commits: 5, pulls: 1, issues: 0 },
                { name: 'Thu', commits: 12, pulls: 5, issues: 3 },
                { name: 'Fri', commits: 8, pulls: 2, issues: 1 },
                { name: 'Sat', commits: 3, pulls: 0, issues: 0 },
                { name: 'Sun', commits: 2, pulls: 0, issues: 0 },
            ]
        }

        const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const now = new Date()
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

        const dailyData = {}
        for (let i = 0; i < days; i++) {
            const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000)
            const key = date.toISOString().split('T')[0]
            dailyData[key] = { commits: 0, pulls: 0, issues: 0 }
        }

        activity.forEach(event => {
            const eventDate = new Date(event.created_at).toISOString().split('T')[0]
            if (dailyData[eventDate]) {
                if (event.type === 'PushEvent') {
                    dailyData[eventDate].commits += event.payload?.commits?.length || 1
                } else if (event.type === 'PullRequestEvent') {
                    dailyData[eventDate].pulls += 1
                } else if (event.type === 'IssuesEvent') {
                    dailyData[eventDate].issues += 1
                }
            }
        })

        return Object.entries(dailyData)
            .map(([date, data]) => ({
                name: dayNames[new Date(date).getDay()],
                commits: data.commits,
                pulls: data.pulls,
                issues: data.issues
            }))
    }, [activity, timeRange])

    // Calculate height to match LanguageChart
    const chartHeight = 340
    // Gate ResponsiveContainer on a measured >0 size so recharts never
    // sees a 0×0 viewport (which logs noisy width/height warnings on
    // every initial paint and collapse/expand cycle).
    const [chartRef, { width: measuredWidth, height: measuredHeight }] = useMeasuredSize()
    const chartReady = measuredWidth > 0 && measuredHeight > 0

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <Card
                className="p-4 sm:p-6 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm transition-all duration-300"
                style={{ minHeight: `${chartHeight + 60}px` }}
            >
                <div className="flex items-center mb-6">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <Activity className="w-5 h-5 text-indigo-500" />
                        Activity Trends
                    </h3>
                </div>
                {loading ? (
                    <Skeleton className="w-full rounded-xl" style={{ height: `${chartHeight}px` }} />
                ) : (
                    <div
                        ref={chartRef}
                        style={{ height: `${chartHeight}px`, width: '100%', overflow: 'hidden' }}
                    >
                        {chartReady && (
                        <ResponsiveContainer
                            width="100%"
                            height="100%"
                            debounce={200}
                        >
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--ds-chart-grid)" opacity={0.1} vertical={false} />
                            <XAxis dataKey="name" stroke="var(--ds-chart-axis)" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                            <YAxis stroke="var(--ds-chart-axis)" fontSize={12} tickLine={false} axisLine={false} dx={-10} />
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
                                labelStyle={{
                                    color: 'var(--ds-chart-tooltip-label)',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    textTransform: 'uppercase',
                                }}
                                cursor={{ stroke: 'var(--ds-chart-series-1)', strokeWidth: 2, strokeDasharray: '5 5' }}
                            />
                            <Line
                                type="monotone"
                                dataKey="commits"
                                stroke="var(--ds-chart-series-1)"
                                strokeWidth={4}
                                dot={{ fill: 'var(--ds-chart-series-1)', strokeWidth: 0, r: 4 }}
                                activeDot={{ r: 8, strokeWidth: 0 }}
                            />
                            <Line
                                type="monotone"
                                dataKey="pulls"
                                stroke="var(--ds-chart-series-2)"
                                strokeWidth={4}
                                dot={{ fill: 'var(--ds-chart-series-2)', strokeWidth: 0, r: 4 }}
                                activeDot={{ r: 8, strokeWidth: 0 }}
                            />
                            <Line
                                type="monotone"
                                dataKey="issues"
                                stroke="var(--ds-chart-series-3)"
                                strokeWidth={4}
                                dot={{ fill: 'var(--ds-chart-series-3)', strokeWidth: 0, r: 4 }}
                                activeDot={{ r: 8, strokeWidth: 0 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                        )}
                    </div>
                )}
            </Card>
        </motion.div>
    )
}
