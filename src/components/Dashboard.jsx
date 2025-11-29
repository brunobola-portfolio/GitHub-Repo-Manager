import { useMemo } from 'react'
import { Card } from './ui/Card'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area } from 'recharts'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b']

export function Dashboard({ stats, orgs, repos = [], onOrgClick }) {
    if (!stats) return null

    const languageData = useMemo(() => {
        const langs = {}
        repos.forEach(repo => {
            if (repo.language) {
                langs[repo.language] = (langs[repo.language] || 0) + 1
            }
        })
        return Object.entries(langs)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5)
    }, [repos])

    // Mock data for "Activity" chart since we don't have historical data for all repos easily
    const activityData = [
        { name: 'Mon', commits: 4 },
        { name: 'Tue', commits: 7 },
        { name: 'Wed', commits: 2 },
        { name: 'Thu', commits: 9 },
        { name: 'Fri', commits: 5 },
        { name: 'Sat', commits: 3 },
        { name: 'Sun', commits: 4 },
    ]

    const statCards = [
        { label: 'Total Repos', value: stats.totalRepos, color: 'bg-blue-500', icon: '📦' },
        { label: 'Public', value: stats.publicRepos, color: 'bg-green-500', icon: '🌍' },
        { label: 'Private', value: stats.privateRepos, color: 'bg-amber-500', icon: '🔒' },
        { label: 'Forks', value: stats.forks, color: 'bg-purple-500', icon: '🍴' },
        { label: 'Archived', value: stats.archived, color: 'bg-slate-500', icon: '📁' },
        { label: 'Organizations', value: stats.organizations, color: 'bg-indigo-500', icon: '🏢' },
    ]

    return (
        <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {statCards.map((stat) => (
                    <Card key={stat.label} hover className="p-4 text-center border-0 shadow-sm bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
                        <div className="text-2xl mb-1">{stat.icon}</div>
                        <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stat.value}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{stat.label}</div>
                    </Card>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Language Distribution */}
                <Card className="p-6 border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-6">Language Distribution</h3>
                    <div className="h-[300px] w-full">
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
                                >
                                    {languageData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap justify-center gap-4 mt-4">
                        {languageData.map((entry, index) => (
                            <div key={entry.name} className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                                <span className="text-sm text-slate-600 dark:text-slate-300">{entry.name}</span>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Activity Chart */}
                <Card className="p-6 border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-6">Weekly Activity</h3>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={activityData}>
                                <defs>
                                    <linearGradient id="colorCommits" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#8b5cf6' }}
                                />
                                <Area type="monotone" dataKey="commits" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorCommits)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </Card>
            </div>

            {/* Organizations */}
            {orgs && orgs.length > 0 && (
                <Card className="p-6 border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <span>🏢</span> Your Organizations
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {orgs.map((org) => (
                            <button
                                key={org.login}
                                onClick={() => onOrgClick?.(org.login)}
                                className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors text-left group"
                            >
                                <img
                                    src={org.avatar_url}
                                    alt={org.login}
                                    className="w-10 h-10 rounded-lg group-hover:scale-105 transition-transform"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{org.login}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                        {(org.public_repos || 0) + (org.total_private_repos || 0)} repos
                                    </div>
                                </div>
                                <span className="text-slate-400 dark:text-slate-500 group-hover:translate-x-1 transition-transform">→</span>
                            </button>
                        ))}
                    </div>
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                        💡 <strong>Tip:</strong> To create a new organization, visit{' '}
                        <a
                            href="https://github.com/organizations/plan"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            github.com/organizations/plan
                        </a>
                    </p>
                </Card>
            )}
        </div>
    )
}

