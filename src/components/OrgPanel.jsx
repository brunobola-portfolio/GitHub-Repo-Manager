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
        <Card className="overflow-hidden">
            {/* Header with gradient */}
            <div className="px-4 py-4 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-700/80 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide flex items-center gap-2.5">
                        <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg shadow-sm">
                            <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Organizations
                    </h3>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleCreateOrg}
                        className="text-xs bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-700/50 shadow-sm"
                        title="Create new organization on GitHub"
                    >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        New
                    </Button>
                </div>
            </div>

            <div className="p-4 space-y-5">

            {/* Create Hint */}
            {showCreateHint && (
                <div className="p-3.5 bg-amber-50 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700 rounded-xl text-sm text-amber-800 dark:text-amber-200 shadow-sm">
                    <p className="font-medium mb-1.5">Creating organization...</p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">After creating on GitHub, refresh this page to see it here.</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline mt-2.5 font-medium"
                    >
                        Refresh now
                    </button>
                </div>
            )}

            {/* User's Personal Account */}
            <div className="space-y-2">
                <button
                    onClick={() => onSelectOrg(null)}
                    className={`w-full flex items-center gap-3.5 p-3.5 rounded-xl transition-all duration-200 ${
                        selectedOrg === null
                            ? 'bg-indigo-50 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 border-2 border-indigo-200 dark:border-indigo-700 shadow-md'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 border-2 border-transparent hover:border-slate-200 dark:hover:border-slate-600'
                    }`}
                >
                    {user?.avatar_url && (
                        <img src={user.avatar_url} alt={user.login} className="w-11 h-11 rounded-full ring-2 ring-white dark:ring-slate-600 shadow-md" />
                    )}
                    <div className="text-left flex-1 min-w-0">
                        <div className="font-semibold truncate">{user?.name || user?.login || 'My Account'}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">@{user?.login}</div>
                    </div>
                    {stats && (
                        <div className="text-right text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/50 px-2.5 py-1.5 rounded-lg">
                            <div className="font-medium">{stats.totalRepos || 0} repos</div>
                        </div>
                    )}
                </button>
            </div>

            {/* Divider */}
            {orgs.length > 0 && (
                <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500 py-1">
                    <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
                    <span className="font-medium uppercase tracking-wider text-[10px]">Organizations</span>
                    <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
                </div>
            )}

	            {/* Organizations List */}
	            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
	                {orgs.map(org => (
	                    <div
	                        key={org.login}
	                        className="relative group"
	                        data-testid="org-card"
	                    >
	                        <button
	                            onClick={() => onSelectOrg(org.login)}
	                            className={`w-full flex items-center gap-3.5 p-3.5 rounded-xl transition-all duration-200 ${
	                                selectedOrg === org.login
	                                    ? 'bg-indigo-50 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 border-2 border-indigo-200 dark:border-indigo-700 shadow-md'
	                                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 border-2 border-transparent hover:border-slate-200 dark:hover:border-slate-600'
	                            }`}
	                        >
	                            <img
	                                src={org.avatar_url}
	                                alt={org.login}
	                                className="w-11 h-11 rounded-xl ring-2 ring-white dark:ring-slate-600 shadow-md"
	                            />
	                            <div className="text-left flex-1 min-w-0">
	                                <div className="font-semibold truncate">{org.login}</div>
	                                <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
	                                    <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/50 px-2 py-0.5 rounded-md">
	                                        <Globe className="w-3 h-3" />
	                                        {org.public_repos || 0}
	                                    </span>
	                                    {org.total_private_repos > 0 && (
	                                        <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/50 px-2 py-0.5 rounded-md">
	                                            <Lock className="w-3 h-3" />
	                                            {org.total_private_repos}
	                                        </span>
	                                    )}
	                                </div>
	                            </div>
	                            <ChevronRight className="w-5 h-5 text-slate-400 dark:text-slate-500 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors" />
	                        </button>

	                        {/* Org Quick Menu trigger (opens overlay) */}
	                        <button
	                            type="button"
	                            onClick={(event) => handleOrgMenuClick(event, org)}
	                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700/70 transition-all shadow-sm"
	                            title="More actions"
	                        >
	                            <MoreVertical className="w-4 h-4 text-slate-500 dark:text-slate-300" />
	                        </button>
	                    </div>
	                ))}
	            </div>

            {/* Empty State */}
            {orgs.length === 0 && (
                <div className="text-center py-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-full w-fit mx-auto mb-3">
                        <Building2 className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 font-medium">No organizations yet</p>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleCreateOrg}
                        className="bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-700/50"
                    >
                        <Plus className="w-4 h-4 mr-1.5" />
                        Create Organization
                    </Button>
                </div>
            )}

	            {/* Quick Links */}
	            <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-1">
	                <a
	                    href="https://github.com/settings/organizations"
	                    target="_blank"
	                    rel="noopener noreferrer"
	                    className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/80 font-medium"
	                >
	                    <Settings className="w-3.5 h-3.5" />
	                    Manage organizations
	                    <ExternalLink className="w-3.5 h-3.5 ml-auto" />
	                </a>
	            </div>
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
