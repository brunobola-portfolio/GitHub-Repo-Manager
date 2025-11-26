import { Card } from './ui/Card'

export function Dashboard({ stats, orgs, onOrgClick }) {
    if (!stats) return null

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
                    <Card key={stat.label} hover className="p-4 text-center">
                        <div className="text-2xl mb-1">{stat.icon}</div>
                        <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{stat.value}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{stat.label}</div>
                    </Card>
                ))}
            </div>

            {/* Organizations */}
            {orgs && orgs.length > 0 && (
                <Card className="p-4">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <span>🏢</span> Your Organizations
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {orgs.map((org) => (
                            <button
                                key={org.login}
                                onClick={() => onOrgClick?.(org.login)}
                                className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors text-left"
                            >
                                <img
                                    src={org.avatar_url}
                                    alt={org.login}
                                    className="w-10 h-10 rounded-lg"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{org.login}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                        {(org.public_repos || 0) + (org.total_private_repos || 0)} repos
                                    </div>
                                </div>
                                <span className="text-slate-400 dark:text-slate-500">→</span>
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

