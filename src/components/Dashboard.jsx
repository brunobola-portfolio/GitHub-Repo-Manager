import React, { useMemo, useState } from 'react'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    PieChart,
    Pie,
    Cell
} from 'recharts'
import { Card } from './ui/Card'
import { ArrowUpRight, ArrowDownRight, Calendar, Filter } from 'lucide-react'

export function Dashboard({ stats, orgs, repos = [], onOrgClick }) {
    const [timeRange, setTimeRange] = useState('7d')

    // Mock data for activity - in a real app this would be filtered by timeRange
    const activityData = [
        { name: 'Mon', commits: 4, prs: 2 },
        { name: 'Tue', commits: 3, prs: 1 },
        { name: 'Wed', commits: 7, prs: 3 },
        { name: 'Thu', commits: 2, prs: 4 },
        { name: 'Fri', commits: 6, prs: 2 },
        { name: 'Sat', commits: 1, prs: 0 },
        { name: 'Sun', commits: 0, prs: 1 },
    ]

    const languageData = useMemo(() => {
        if (!repos || repos.length === 0) return []
        const languages = {}
        repos.forEach(repo => {
            if (repo.language) {
                languages[repo.language] = (languages[repo.language] || 0) + 1
            }
        })
        return Object.entries(languages)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5)
    }, [repos])

    const orgData = useMemo(() => {
        if (!orgs) return []
        return orgs
            .map(org => ({
                name: org.login,
                repos: (org.public_repos || 0) + (org.total_private_repos || 0)
            }))
            .sort((a, b) => b.repos - a.repos)
            .slice(0, 5)
    }, [orgs])

    const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316']

    return (
        <div className="space-y-6">
            {/* Header & Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Overview</h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Global metrics across all organizations</p>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-800">
                    {['7d', '30d', '90d'].map((range) => (
                        <button
                            key={range}
                            onClick={() => setTimeRange(range)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${timeRange === range
                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                        >
                            {range}
                        </button>
                    ))}
                </div>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Key Metrics - Row 1 */}
                <StatCard
                    label="Total Repositories"
                    value={stats?.totalRepos || 0}
                    trend="+12%"
                    trendUp={true}
                    className="md:col-span-2 lg:col-span-1"
                />
                <StatCard
                    label="Total Stars"
                    value={stats?.totalStars || 0}
                    trend="+5%"
                    trendUp={true}
                />
                <StatCard
                    label="Total Forks"
                    value={stats?.totalForks || 0}
                    trend="-2%"
                    trendUp={false}
                />
                <StatCard
                    label="Active Issues"
                    value="24"
                    trend="+4"
                    trendUp={false} // More issues might be bad, or just neutral
                    inverseTrend // Red if goes up? Let's keep simple for now
                />

                {/* Main Chart - Large Area */}
                <Card className="md:col-span-2 lg:col-span-3 row-span-2 p-6 border border-slate-200 dark:border-slate-700/60 shadow-sm dark:shadow-xl dark:shadow-black/40 bg-white/50 dark:bg-slate-900/60 backdrop-blur-xl">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="font-semibold text-slate-900 dark:text-white">Activity Trends</h3>
                        <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
                                <span className="text-slate-500 dark:text-slate-400">Commits</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-emerald-400"></span>
                                <span className="text-slate-500 dark:text-slate-400">PRs</span>
                            </div>
                        </div>
                    </div>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={activityData}>
                                <defs>
                                    <linearGradient id="colorCommits" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorPRs" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'currentColor' }} className="text-slate-400 text-xs" dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'currentColor' }} className="text-slate-400 text-xs" />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: 'none', borderRadius: '8px', color: '#fff' }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Area type="monotone" dataKey="commits" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorCommits)" />
                                <Area type="monotone" dataKey="prs" stroke="#34d399" strokeWidth={3} fillOpacity={1} fill="url(#colorPRs)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                {/* Top Orgs - Side Bar */}
                <Card className="md:col-span-2 lg:col-span-1 row-span-2 p-6 border border-slate-200 dark:border-slate-700/60 shadow-sm dark:shadow-xl dark:shadow-black/40 bg-white/50 dark:bg-slate-900/60 backdrop-blur-xl flex flex-col">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-6">Top Organizations</h3>
                    <div className="flex-1 min-h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={orgData} layout="vertical" margin={{ left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={100} tick={{ fill: 'currentColor', fontSize: 12 }} className="text-slate-500 dark:text-slate-400" />
                                <Tooltip
                                    cursor={{ fill: 'transparent' }}
                                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: 'none', borderRadius: '8px', color: '#fff' }}
                                />
                                <Bar dataKey="repos" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                {/* Language Distribution - Bottom Row */}
                <Card className="md:col-span-2 lg:col-span-2 p-6 border border-slate-200 dark:border-slate-700/60 shadow-sm dark:shadow-xl dark:shadow-black/40 bg-white/50 dark:bg-slate-900/60 backdrop-blur-xl">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Languages</h3>
                    <div className="h-[200px] flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={languageData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    {languageData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', border: 'none', borderRadius: '8px', color: '#fff' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="ml-8 grid grid-cols-2 gap-x-8 gap-y-2">
                            {languageData.map((entry, index) => (
                                <div key={entry.name} className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                                    <span className="text-sm text-slate-600 dark:text-slate-300">{entry.name}</span>
                                    <span className="text-sm font-medium text-slate-900 dark:text-white">{Math.round((entry.value / repos.length) * 100)}%</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>

                {/* Your Organizations List - Bottom Row */}
                <Card className="md:col-span-2 lg:col-span-2 p-6 border border-slate-200 dark:border-slate-700/60 shadow-sm dark:shadow-xl dark:shadow-black/40 bg-white/50 dark:bg-slate-900/60 backdrop-blur-xl">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-slate-900 dark:text-white">Your Organizations</h3>
                        <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {orgs?.length || 0} Total
                        </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                        {orgs?.map(org => (
                            <div
                                key={org.id}
                                onClick={() => onOrgClick(org.login)}
                                className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                            >
                                <img
                                    src={org.avatar_url}
                                    alt={org.login}
                                    className="w-10 h-10 rounded-lg bg-slate-200 dark:bg-slate-800"
                                />
                                <div className="flex-1 min-w-0">
                                    <h4 className="font-medium text-slate-900 dark:text-white truncate group-hover:text-indigo-500 transition-colors">
                                        {org.login}
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                        {org.description || 'No description'}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    )
}

function StatCard({ label, value, trend, trendUp, className }) {
    return (
        <Card className={`p-6 border border-slate-200 dark:border-slate-700/60 shadow-sm dark:shadow-xl dark:shadow-black/40 bg-white/50 dark:bg-slate-900/60 backdrop-blur-xl flex flex-col justify-between ${className}`}>
            <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
                <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-2 tracking-tight">{value}</h3>
            </div>
            <div className={`flex items-center gap-1 mt-4 text-sm font-medium ${trendUp ? 'text-emerald-500' : 'text-rose-500'}`}>
                {trendUp ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                <span>{trend}</span>
                <span className="text-slate-400 dark:text-slate-500 font-normal ml-1">vs last period</span>
            </div>
        </Card>
    )
}
