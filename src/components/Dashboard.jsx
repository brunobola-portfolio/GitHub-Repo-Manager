import React, { useState, useMemo } from 'react'
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, LineChart, Line
} from 'recharts'
import {
    GitFork, Star, Eye, Archive, Folder,
    Activity, Building2, Code2, Loader2, ChevronDown, Check
} from 'lucide-react'
import { Card } from './ui/Card'
import { Skeleton } from './ui/Skeleton'
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion'
import * as Popover from '@radix-ui/react-popover'

const COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444']

export function Dashboard({ stats, orgs, repos = [], selectedOrg, onSelectOrg, loading, activity = [] }) {
    const [timeRange, setTimeRange] = useState('7d')

    // Transform activity data into chart format
    const activityChartData = useMemo(() => {
        if (!activity || activity.length === 0) {
            // Fallback to mock data if no activity
            return [
                { name: 'Mon', commits: 4, pulls: 2 },
                { name: 'Tue', commits: 7, pulls: 3 },
                { name: 'Wed', commits: 5, pulls: 1 },
                { name: 'Thu', commits: 12, pulls: 5 },
                { name: 'Fri', commits: 8, pulls: 2 },
                { name: 'Sat', commits: 3, pulls: 0 },
                { name: 'Sun', commits: 2, pulls: 0 },
            ]
        }

        // Get days based on timeRange
        const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const now = new Date()
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

        // Group activity by day
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

        // Convert to array format for chart
        return Object.entries(dailyData)
            .slice(-7) // Show last 7 data points for readability
            .map(([date, data]) => ({
                name: dayNames[new Date(date).getDay()],
                commits: data.commits,
                pulls: data.pulls,
            }))
    }, [activity, timeRange])

    const orgData = useMemo(() => {
        if (!orgs) return []
        // Use the counts directly from the org object (enriched by backend)
        const data = orgs.map(org => ({
            name: org.login,
            repos: (org.public_repos || 0) + (org.total_private_repos || 0)
        })).sort((a, b) => b.repos - a.repos).slice(0, 5)
        return data
    }, [orgs])

    const languageData = useMemo(() => {
        // Use stats.languages from backend if available for complete picture
        if (stats?.languages) {
            return Object.entries(stats.languages)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 6)
        }

        // Fallback to client-side calc if stats not available (e.g. initial load)
        if (!repos) return []
        const langs = {}
        repos.forEach(repo => {
            if (repo.language) {
                langs[repo.language] = (langs[repo.language] || 0) + 1
            }
        })
        return Object.entries(langs)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 6)
    }, [repos, stats])

    const containerVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.5, staggerChildren: 0.1 }
        }
    }

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0 }
    }

    const selectedOrgData = orgs?.find(o => o.login === selectedOrg)

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-8"
        >
            {/* Header with Premium Org Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div>
                    <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 tracking-tight">
                        Dashboard
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
                        Overview of your GitHub ecosystem
                    </p>
                </div>

                <div className="relative z-20">
                    <Popover.Root>
                        <Popover.Trigger asChild>
                            <button
                                disabled={loading}
                                className="flex items-center gap-3 px-4 py-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-500/50 transition-all min-w-[240px] justify-between group"
                            >
                                <div className="flex items-center gap-3">
                                    {selectedOrgData ? (
                                        <img src={selectedOrgData.avatar_url} alt={selectedOrg} className="w-8 h-8 rounded-lg ring-2 ring-white dark:ring-slate-700 shadow-sm" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                            <Building2 size={18} />
                                        </div>
                                    )}
                                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                                        {selectedOrg || 'All Organizations'}
                                    </span>
                                </div>
                                {loading ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                                )}
                            </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                            <Popover.Content
                                className="w-[280px] p-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 z-50"
                                sideOffset={8}
                            >
                                <div className="max-h-[300px] overflow-y-auto space-y-1 custom-scrollbar pr-1">
                                    <button
                                        onClick={() => onSelectOrg('')}
                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${!selectedOrg
                                            ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                            }`}
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                            <Building2 size={16} />
                                        </div>
                                        <span className="font-medium flex-1 text-left">All Organizations</span>
                                        {!selectedOrg && <Check size={16} className="text-indigo-500" />}
                                    </button>

                                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

                                    {orgs?.map(org => (
                                        <button
                                            key={org.login}
                                            onClick={() => onSelectOrg(org.login)}
                                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${selectedOrg === org.login
                                                ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                                                : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                                }`}
                                        >
                                            <img src={org.avatar_url} alt={org.login} className="w-8 h-8 rounded-lg object-cover" />
                                            <span className="font-medium flex-1 text-left truncate">{org.login}</span>
                                            {selectedOrg === org.login && <Check size={16} className="text-indigo-500" />}
                                        </button>
                                    ))}
                                </div>
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>
                </div>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {loading ? (
                    Array(4).fill(0).map((_, i) => (
                        <Skeleton key={i} className="h-32 rounded-2xl" />
                    ))
                ) : (
                    <>
                        <StatCard
                            title="Total Repositories"
                            value={stats?.totalRepos || 0}
                            icon={Folder}
                            color="text-blue-500"
                            bg="bg-blue-500/10"
                            trend="+12% from last month"
                        />
                        <StatCard
                            title="Public / Private"
                            value={`${stats?.publicRepos || 0} / ${stats?.privateRepos || 0}`}
                            icon={Archive}
                            color="text-purple-500"
                            bg="bg-purple-500/10"
                            trend="Distribution"
                        />
                        <StatCard
                            title="Total Forks"
                            value={stats?.forks || 0}
                            icon={GitFork}
                            color="text-indigo-500"
                            bg="bg-indigo-500/10"
                            trend="Across all repos"
                        />
                        <StatCard
                            title="Organizations"
                            value={stats?.organizations || 0}
                            icon={Building2}
                            color="text-emerald-500"
                            bg="bg-emerald-500/10"
                            trend="Active memberships"
                        />
                    </>
                )}
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Activity Chart */}
                <motion.div variants={itemVariants}>
                    <Card className="p-6 h-[420px] bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 shadow-xl">
                        <div className="flex items-center justify-between mb-8">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <Activity className="w-5 h-5 text-indigo-500" />
                                Activity Trends
                            </h3>
                            <select
                                value={timeRange}
                                onChange={(e) => setTimeRange(e.target.value)}
                                className="text-sm border-none bg-slate-100 dark:bg-slate-800/50 rounded-lg px-3 py-1.5 focus:ring-0 cursor-pointer font-medium text-slate-600 dark:text-slate-300"
                            >
                                <option value="7d">Last 7 days</option>
                                <option value="30d">Last 30 days</option>
                                <option value="90d">Last 3 months</option>
                            </select>
                        </div>
                        {loading ? (
                            <Skeleton className="w-full h-[300px] rounded-xl" />
                        ) : (
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={activityChartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} vertical={false} />
                                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                                    <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} dx={-10} />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                                            backdropFilter: 'blur(16px)',
                                            border: '1px solid rgba(148, 163, 184, 0.2)',
                                            borderRadius: '16px',
                                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
                                            padding: '12px 16px',
                                        }}
                                        itemStyle={{
                                            color: '#f8fafc',
                                            fontSize: '13px',
                                            fontWeight: '500',
                                            padding: '4px 0',
                                        }}
                                        labelStyle={{
                                            color: '#94a3b8',
                                            fontSize: '11px',
                                            fontWeight: '600',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.05em',
                                            marginBottom: '8px',
                                        }}
                                        cursor={{ stroke: '#6366f1', strokeWidth: 2, strokeDasharray: '5 5' }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="commits"
                                        stroke="#6366f1"
                                        strokeWidth={4}
                                        dot={{ fill: '#6366f1', strokeWidth: 0, r: 4 }}
                                        activeDot={{ r: 8, strokeWidth: 0 }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="pulls"
                                        stroke="#ec4899"
                                        strokeWidth={4}
                                        dot={{ fill: '#ec4899', strokeWidth: 0, r: 4 }}
                                        activeDot={{ r: 8, strokeWidth: 0 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </Card>
                </motion.div>

                {/* Language Distribution */}
                <motion.div variants={itemVariants}>
                    <Card className="p-6 h-[420px] bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 shadow-xl">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-8 flex items-center gap-2">
                            <Code2 className="w-5 h-5 text-pink-500" />
                            Language Distribution
                        </h3>
                        {loading ? (
                            <div className="flex items-center justify-center h-[300px]">
                                <Skeleton className="w-64 h-64 rounded-full" />
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                    <Pie
                                        data={languageData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={80}
                                        outerRadius={120}
                                        paddingAngle={5}
                                        dataKey="value"
                                        cornerRadius={6}
                                    >
                                        {languageData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                                            backdropFilter: 'blur(16px)',
                                            border: '1px solid rgba(148, 163, 184, 0.2)',
                                            borderRadius: '16px',
                                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
                                            padding: '12px 16px',
                                        }}
                                        itemStyle={{
                                            color: '#f8fafc',
                                            fontSize: '13px',
                                            fontWeight: '500',
                                            padding: '4px 0',
                                        }}
                                        labelStyle={{
                                            color: '#94a3b8',
                                            fontSize: '11px',
                                            fontWeight: '600',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.05em',
                                            marginBottom: '8px',
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </Card>
                </motion.div>

                {/* Top Organizations */}
                <motion.div variants={itemVariants} className="lg:col-span-2">
                    <Card className="p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 shadow-xl">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-8 flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-emerald-500" />
                            Top Organizations
                        </h3>
                        <div className="h-[300px]">
                            {loading ? (
                                <Skeleton className="w-full h-full rounded-xl" />
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={orgData} layout="vertical" margin={{ left: 20, right: 20 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} horizontal={false} />
                                        <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                        <YAxis
                                            dataKey="name"
                                            type="category"
                                            stroke="#94a3b8"
                                            fontSize={12}
                                            tickLine={false}
                                            axisLine={false}
                                            width={120}
                                        />
                                        <Tooltip
                                            cursor={{ fill: '#6366f1', opacity: 0.08, radius: 8 }}
                                            contentStyle={{
                                                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                                                backdropFilter: 'blur(16px)',
                                                border: '1px solid rgba(148, 163, 184, 0.2)',
                                                borderRadius: '16px',
                                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
                                                padding: '12px 16px',
                                            }}
                                            itemStyle={{
                                                color: '#f8fafc',
                                                fontSize: '13px',
                                                fontWeight: '500',
                                                padding: '4px 0',
                                            }}
                                            labelStyle={{
                                                color: '#94a3b8',
                                                fontSize: '11px',
                                                fontWeight: '600',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em',
                                                marginBottom: '8px',
                                            }}
                                        />
                                        <Bar dataKey="repos" fill="#14b8a6" radius={[0, 6, 6, 0]} barSize={24} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </Card>
                </motion.div>
            </div>
        </motion.div>
    )
}

// eslint-disable-next-line no-unused-vars
function StatCard({ title, value, icon: IconComp, color, bg, trend }) {
    return (
        <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: "spring", stiffness: 300 }}
        >
            <Card className="p-6 hover:shadow-xl transition-all duration-300 border-slate-200/60 dark:border-slate-800/60 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl group">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{title}</p>
                        <h3 className="text-3xl font-extrabold text-slate-900 dark:text-white mt-3 group-hover:text-transparent bg-clip-text group-hover:bg-gradient-to-r group-hover:from-indigo-500 group-hover:to-purple-500 transition-all">
                            {value}
                        </h3>
                        {trend && (
                            <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5 font-medium">
                                <span className="text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px]">↑ 12%</span>
                                {trend}
                            </p>
                        )}
                    </div>
                    <div className={`p-4 rounded-2xl ${bg} group-hover:scale-110 transition-transform duration-300`}>
                        <IconComp className={`w-6 h-6 ${color}`} />
                    </div>
                </div>
            </Card>
        </motion.div>
    )
}
