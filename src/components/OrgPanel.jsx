import { useState } from 'react'
import { Building2, Plus, ExternalLink, Lock, Globe, Settings, ChevronRight, MoreVertical } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'

export function OrgPanel({
    orgs = [],
    selectedOrg,
    onSelectOrg,
    user,
    stats,
	    onManageOrg
}) {
    const [showCreateHint, setShowCreateHint] = useState(false)
    const [showOrgMenu, setShowOrgMenu] = useState(null)

    const handleCreateOrg = () => {
        // Open GitHub org creation in new tab (API doesn't support org creation)
        window.open('https://github.com/organizations/plan', '_blank')
        setShowCreateHint(true)
    }

    return (
        <Card className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Organizations
                </h3>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCreateOrg}
                    className="text-xs"
                    title="Create new organization on GitHub"
                >
                    <Plus className="w-3 h-3 mr-1" />
                    New
                </Button>
            </div>

            {/* Create Hint */}
            {showCreateHint && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    <p className="font-medium mb-1">Creating organization...</p>
                    <p className="text-xs">After creating on GitHub, refresh this page to see it here.</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="text-xs text-amber-600 hover:text-amber-700 underline mt-2"
                    >
                        Refresh now
                    </button>
                </div>
            )}

            {/* User's Personal Account */}
            <div className="space-y-1">
                <button
                    onClick={() => onSelectOrg(null)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
                        selectedOrg === null
                            ? 'bg-indigo-50 text-indigo-800 border-2 border-indigo-200 shadow-sm'
                            : 'hover:bg-slate-50 text-slate-700 border-2 border-transparent'
                    }`}
                >
                    {user?.avatar_url && (
                        <img src={user.avatar_url} alt={user.login} className="w-10 h-10 rounded-full ring-2 ring-white shadow" />
                    )}
                    <div className="text-left flex-1 min-w-0">
                        <div className="font-medium truncate">{user?.name || user?.login || 'My Account'}</div>
                        <div className="text-xs text-slate-500">@{user?.login}</div>
                    </div>
                    {stats && (
                        <div className="text-right text-xs text-slate-500">
                            <div>{stats.totalRepos || 0} repos</div>
                        </div>
                    )}
                </button>
            </div>

            {/* Divider */}
            {orgs.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <div className="flex-1 border-t border-slate-200" />
                    <span>Organizations</span>
                    <div className="flex-1 border-t border-slate-200" />
                </div>
            )}

            {/* Organizations List */}
            <div className="space-y-1 max-h-64 overflow-y-auto">
                {orgs.map(org => (
                    <div key={org.login} className="relative group">
                        <button
                            onClick={() => onSelectOrg(org.login)}
                            className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
                                selectedOrg === org.login
                                    ? 'bg-indigo-50 text-indigo-800 border-2 border-indigo-200 shadow-sm'
                                    : 'hover:bg-slate-50 text-slate-700 border-2 border-transparent'
                            }`}
                        >
                            <img
                                src={org.avatar_url}
                                alt={org.login}
                                className="w-10 h-10 rounded-lg ring-2 ring-white shadow"
                            />
                            <div className="text-left flex-1 min-w-0">
                                <div className="font-medium truncate">{org.login}</div>
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <span className="flex items-center gap-1">
                                        <Globe className="w-3 h-3" />
                                        {org.public_repos || 0}
                                    </span>
                                    {org.total_private_repos > 0 && (
                                        <span className="flex items-center gap-1">
                                            <Lock className="w-3 h-3" />
                                            {org.total_private_repos}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                        </button>

                        {/* Org Quick Menu */}
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowOrgMenu(showOrgMenu === org.login ? null : org.login) }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-slate-200 transition-all"
                        >
                            <MoreVertical className="w-4 h-4 text-slate-500" />
                        </button>

                        {showOrgMenu === org.login && (
                            <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-10">
                                <button
                                    onClick={() => { onManageOrg?.(org); setShowOrgMenu(null) }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    <Settings className="w-4 h-4" />
                                    Manage
                                </button>
                                <a
                                    href={`https://github.com/${org.login}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                    View on GitHub
                                </a>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Empty State */}
            {orgs.length === 0 && (
                <div className="text-center py-6 border-2 border-dashed border-slate-200 rounded-lg">
                    <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-500 mb-3">No organizations yet</p>
                    <Button variant="secondary" size="sm" onClick={handleCreateOrg}>
                        <Plus className="w-4 h-4 mr-1" />
                        Create Organization
                    </Button>
                </div>
            )}

            {/* Quick Links */}
            <div className="pt-3 border-t border-slate-200 space-y-1">
                <a
                    href="https://github.com/settings/organizations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-slate-500 hover:text-indigo-600 transition-colors p-2 rounded hover:bg-slate-50"
                >
                    <Settings className="w-3 h-3" />
                    Manage organizations
                    <ExternalLink className="w-3 h-3 ml-auto" />
                </a>
            </div>
        </Card>
    )
}

