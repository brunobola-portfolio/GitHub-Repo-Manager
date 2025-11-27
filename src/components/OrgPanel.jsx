import { useState, useEffect } from 'react'
import { Building2, Plus, ExternalLink, Users, GitFork, Lock, Globe, Settings, ChevronRight, MoreVertical, RefreshCw } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'

export function OrgPanel({
    orgs = [],
    selectedOrg,
    onSelectOrg,
    user,
    onCreateOrg,
    stats,
    onManageOrg,
    onRefresh
}) {
	    const [showCreateHint, setShowCreateHint] = useState(false)
	    const [orgMenu, setOrgMenu] = useState(null) // { org, x, y, width } | null

	    useEffect(() => {
	        if (!orgMenu) return

	        const handleKeyDown = (event) => {
	            if (event.key === 'Escape') {
	                setOrgMenu(null)
	            }
	        }

	        const handleScroll = () => {
	            setOrgMenu(null)
	        }

	        window.addEventListener('keydown', handleKeyDown)
	        window.addEventListener('scroll', handleScroll, true)

	        return () => {
	            window.removeEventListener('keydown', handleKeyDown)
	            window.removeEventListener('scroll', handleScroll, true)
	        }
	    }, [orgMenu])

	    const openOrgMenuAtPosition = (org, clientX, clientY) => {
	        let x = clientX
	        let y = clientY
	        let width = 260

	        if (typeof window !== 'undefined') {
	            const margin = 8
	            const { innerWidth, innerHeight } = window
	            width = Math.min(width, innerWidth - margin * 2)
	            const estimatedHeight = 220
	            if (x + width > innerWidth - margin) {
	                x = innerWidth - width - margin
	            }
	            if (y + estimatedHeight > innerHeight - margin) {
	                y = innerHeight - estimatedHeight - margin
	            }
	            if (x < margin) x = margin
	            if (y < margin) y = margin
	        }

	        setOrgMenu({ org, x, y, width })
	    }

	    const handleOrgMenuClick = (event, org) => {
	        event.preventDefault()
	        event.stopPropagation()
	        const rect = event.currentTarget.getBoundingClientRect()
	        openOrgMenuAtPosition(org, rect.right, rect.bottom + 4)
	    }

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
	                    <div
	                        key={org.login}
	                        className="relative group"
	                        data-testid="org-card"
	                    >
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

	                        {/* Org Quick Menu trigger (opens overlay) */}
	                        <button
	                            type="button"
	                            onClick={(event) => handleOrgMenuClick(event, org)}
	                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700/70 transition-all"
	                            title="More actions"
	                        >
	                            <MoreVertical className="w-4 h-4 text-slate-500 dark:text-slate-300" />
	                        </button>
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

	            {/* Org actions overlay menu */}
	            {orgMenu && (
	                <div
	                    className="fixed inset-0 z-40 bg-black/10 dark:bg-black/30 backdrop-blur-[1px]"
	                    onClick={() => setOrgMenu(null)}
	                    onContextMenu={(event) => {
	                        event.preventDefault()
	                        setOrgMenu(null)
	                    }}
	                >
	                    <div
	                        className="absolute z-50"
	                        style={{ top: orgMenu.y, left: orgMenu.x, width: orgMenu.width }}
	                        onClick={(event) => event.stopPropagation()}
	                    >
	                        <OrgActionsMenu
	                            org={orgMenu.org}
	                            onManageOrg={onManageOrg}
	                            onRefresh={onRefresh}
	                            onClose={() => setOrgMenu(null)}
	                        />
	                    </div>
	                </div>
	            )}
	        </Card>
	    )
}

function OrgActionsMenu({ org, onManageOrg, onRefresh, onClose }) {
	const handleClick = (action) => {
		if (action === 'manage') {
			onManageOrg?.(org)
		} else if (action === 'refresh') {
			onRefresh?.(org)
		}
		onClose?.()
	}

	return (
		<div
			data-testid="org-actions-menu"
			className="rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-50 shadow-xl dark:shadow-slate-900/50 border border-slate-200 dark:border-slate-700 overflow-hidden"
		>
			<div className="px-4 pt-3 pb-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
				<img
					src={org.avatar_url}
					alt={org.login}
					className="w-8 h-8 rounded-lg ring-2 ring-white/80 shadow"
				/>
				<div className="flex-1 min-w-0">
					<div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-0.5">
						Organization
					</div>
					<div className="font-medium text-sm text-slate-900 dark:text-slate-50 truncate">
						{org.login}
					</div>
				</div>
			</div>

			<div className="px-2 py-2 border-b border-slate-100 dark:border-slate-700/80">
				<div className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 px-2 mb-1">
					Actions
				</div>
				<div className="space-y-0.5">
					<button
						type="button"
						onClick={() => handleClick('manage')}
						className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70"
					>
						<Settings className="w-4 h-4" />
						<span className="flex-1 text-left">Manage organization</span>
					</button>
					<button
						type="button"
						onClick={() => {
							window.open(`https://github.com/${org.login}`, '_blank', 'noopener,noreferrer')
							onClose?.()
						}}
						className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70"
					>
						<ExternalLink className="w-4 h-4" />
						<span className="flex-1 text-left">View on GitHub</span>
					</button>
					<button
						type="button"
						onClick={() => handleClick('refresh')}
						className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70"
					>
						<RefreshCw className="w-4 h-4" />
						<span className="flex-1 text-left">Refresh organization repos</span>
					</button>
				</div>
			</div>
		</div>
	)
}
