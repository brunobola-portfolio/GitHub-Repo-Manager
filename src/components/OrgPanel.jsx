import { useState, useEffect } from 'react'
import { Building2, Plus, ExternalLink, Users, GitFork, Lock, Globe, Settings, ChevronRight, MoreVertical, RefreshCw, User } from 'lucide-react'
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
		window.open('https://github.com/organizations/plan', '_blank')
		setShowCreateHint(true)
	}

	return (
		<Card className="overflow-hidden min-w-0 border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
			{/* Header */}
			<div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
				<h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
					<Building2 className="w-4 h-4 text-indigo-500" />
					Context
				</h3>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleCreateOrg}
					className="h-7 px-2 text-xs text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
					title="Create new organization"
				>
					<Plus className="w-3.5 h-3.5" />
				</Button>
			</div>

			<div className="p-4 space-y-6">
				{/* Personal Account Section */}
				<div className="space-y-3">
					<div className="px-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
						Personal
					</div>
					<button
						onClick={() => onSelectOrg(null)}
						className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group ${selectedOrg === null
							? 'bg-indigo-50/80 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100 ring-1 ring-indigo-200 dark:ring-indigo-700 shadow-sm'
							: 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
							}`}
					>
						<div className="relative">
							{user?.avatar_url ? (
								<img src={user.avatar_url} alt={user.login} className="w-10 h-10 rounded-full ring-2 ring-white dark:ring-slate-800 shadow-sm" />
							) : (
								<div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
									<User className="w-5 h-5 text-slate-500" />
								</div>
							)}
							<div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center ${selectedOrg === null ? 'bg-indigo-500' : 'bg-slate-400'}`}>
								<User className="w-2.5 h-2.5 text-white" />
							</div>
						</div>
						<div className="text-left flex-1 min-w-0">
							<div className="font-semibold truncate text-sm">{user?.name || user?.login}</div>
							<div className="text-xs text-slate-500 dark:text-slate-400 truncate">@{user?.login}</div>
						</div>
						{selectedOrg === null && <ChevronRight className="w-5 h-5 text-indigo-500" />}
					</button>
				</div>

				{/* Organizations Section */}
				<div className="space-y-3">
					<div className="px-2 flex items-center justify-between">
						<div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
							Organizations
						</div>
						<span className="text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
							{orgs.length}
						</span>
					</div>

					<div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
						{orgs.length === 0 ? (
							<div className="text-center py-8 px-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
								<p className="text-sm text-slate-500 dark:text-slate-400">No organizations found</p>
								<Button
									variant="link"
									size="sm"
									onClick={handleCreateOrg}
									className="text-sm mt-1 h-auto p-0 text-indigo-600 dark:text-indigo-400 font-medium"
								>
									Create one
								</Button>
							</div>
						) : (
							orgs.map(org => (
								<div key={org.login} className="relative group/item">
									<button
										onClick={() => onSelectOrg(org.login)}
										className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 ${selectedOrg === org.login
											? 'bg-indigo-50/80 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100 ring-1 ring-indigo-200 dark:ring-indigo-700 shadow-sm'
											: 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
											}`}
									>
										<img
											src={org.avatar_url}
											alt={org.login}
											className="w-10 h-10 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm bg-white dark:bg-slate-800 object-cover"
										/>
										<div className="text-left flex-1 min-w-0">
											<div className="font-semibold truncate text-sm">{org.login}</div>
											<div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
										{selectedOrg === org.login && <ChevronRight className="w-5 h-5 text-indigo-500" />}
									</button>

									<button
										onClick={(e) => handleOrgMenuClick(e, org)}
										className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg opacity-0 group-hover/item:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-all"
									>
										<MoreVertical className="w-4 h-4" />
									</button>
								</div>
							))
						)}
					</div>
				</div>
			</div>

			{/* Footer Links */}
			<div className="px-4 py-3 bg-slate-50/50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
				<a
					href="https://github.com/settings/organizations"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
				>
					<Settings className="w-3.5 h-3.5" />
					Manage on GitHub
				</a>
			</div>

			{/* Org actions overlay menu */}
			{orgMenu && (
				<div
					className="fixed inset-0 z-50 bg-transparent"
					onClick={() => setOrgMenu(null)}
					onContextMenu={(e) => {
						e.preventDefault()
						setOrgMenu(null)
					}}
				>
					<div
						className="absolute z-50"
						style={{ top: orgMenu.y, left: orgMenu.x, width: orgMenu.width }}
						onClick={(e) => e.stopPropagation()}
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
		<div className="rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-50 shadow-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
			<div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/50 flex items-center gap-2">
				<img
					src={org.avatar_url}
					alt={org.login}
					className="w-6 h-6 rounded-md"
				/>
				<span className="font-medium text-xs truncate flex-1">{org.login}</span>
			</div>

			<div className="p-1">
				<button
					onClick={() => handleClick('manage')}
					className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300 transition-colors"
				>
					<Settings className="w-3.5 h-3.5" />
					Manage Settings
				</button>
				<button
					onClick={() => {
						window.open(`https://github.com/${org.login}`, '_blank', 'noopener,noreferrer')
						onClose?.()
					}}
					className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300 transition-colors"
				>
					<ExternalLink className="w-3.5 h-3.5" />
					View on GitHub
				</button>
				<div className="my-1 border-t border-slate-100 dark:border-slate-700/50" />
				<button
					onClick={() => handleClick('refresh')}
					className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300 transition-colors"
				>
					<RefreshCw className="w-3.5 h-3.5" />
					Sync Repositories
				</button>
			</div>
		</div>
	)
}
