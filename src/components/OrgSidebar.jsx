import { Card } from './ui/Card'

export function OrgSidebar({ orgs, selectedOrg, onSelectOrg, user }) {
    return (
        <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                Filter by Owner
            </h3>

            <div className="space-y-1">
                {/* User's repos */}
                <button
                    onClick={() => onSelectOrg(null)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors text-left ${
                        selectedOrg === null
                            ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-700'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                >
                    {user?.avatar_url && (
                        <img src={user.avatar_url} alt={user.login} className="w-6 h-6 rounded-full" />
                    )}
                    <span className="font-medium truncate">{user?.login || 'My Repos'}</span>
                </button>

                {/* Divider */}
                {orgs && orgs.length > 0 && (
                    <div className="border-t border-slate-200 dark:border-slate-700 my-2" />
                )}

                {/* Organizations */}
                {orgs?.map((org) => (
                    <button
                        key={org.login}
                        onClick={() => onSelectOrg(org.login)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors text-left ${
                            selectedOrg === org.login
                                ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-700'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                    >
                        <img src={org.avatar_url} alt={org.login} className="w-6 h-6 rounded-lg" />
                        <span className="font-medium truncate flex-1">{org.login}</span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                            {(org.public_repos || 0) + (org.total_private_repos || 0)}
                        </span>
                    </button>
                ))}
            </div>

            {/* Create org hint */}
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                <a
                    href="https://github.com/organizations/plan"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                    <span>➕</span>
                    <span>Create new organization</span>
                </a>
            </div>
        </Card>
    )
}

