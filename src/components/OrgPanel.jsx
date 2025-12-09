import React, { useState } from 'react'
import {
	Building2, Plus, Search,
	Settings, Shield,
	ChevronRight, LayoutGrid, List
} from 'lucide-react'
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { SettingsModal } from './SettingsModal'

export function OrgPanel({
	orgs = [],
	selectedOrg,
	onSelectOrg,
	user,
	onCreateOrg,
	stats
}) {
	const [searchTerm, setSearchTerm] = useState('')
	const [viewMode, setViewMode] = useState('list') // 'list' or 'grid'
	const [isSettingsOpen, setIsSettingsOpen] = useState(false)

	const filteredOrgs = orgs.filter(org =>
		org.login.toLowerCase().includes(searchTerm.toLowerCase())
	)

	return (
		<div className="h-full flex flex-col bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-xl border-r border-slate-200 dark:border-slate-800 w-80 transition-all duration-300">
			{/* Header */}
			<div className="p-4 border-b border-slate-200 dark:border-slate-800">
				<div className="flex items-center justify-between mb-4">
					<h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
						<Building2 className="w-5 h-5 text-indigo-500" />
						Organizations
					</h2>
					<div className="flex items-center gap-1">
						<button
							onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
							className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
							title={viewMode === 'list' ? "Switch to Grid View" : "Switch to List View"}
						>
							{viewMode === 'list' ? <LayoutGrid size={18} /> : <List size={18} />}
						</button>
						<button
							onClick={onCreateOrg}
							className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
							title="Add Organization"
						>
							<Plus size={18} />
						</button>
					</div>
				</div>

				{/* Search */}
				<div className="relative">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
					<input
						type="text"
						placeholder="Search orgs..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
					/>
				</div>
			</div>

			{/* Org List */}
			<div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
				<div className={viewMode === 'grid' ? "grid grid-cols-2 gap-2" : "space-y-2"}>
					<AnimatePresence mode="popLayout">
						<motion.button
							layout
							initial={{ opacity: 0, y: 10 }}
							animate={{ opacity: 1, y: 0 }}
							onClick={() => onSelectOrg('')}
							className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all border ${!selectedOrg
								? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 shadow-sm'
								: 'bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
								} ${viewMode === 'grid' ? 'flex-col text-center p-4' : ''}`}
						>
							<div className={`rounded-lg flex items-center justify-center ${!selectedOrg
								? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
								: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
								} ${viewMode === 'grid' ? 'w-12 h-12 mb-2' : 'w-10 h-10'}`}>
								<LayoutGrid size={viewMode === 'grid' ? 24 : 20} />
							</div>
							<div className={`flex-1 ${viewMode === 'grid' ? 'w-full' : 'text-left'}`}>
								<h3 className={`font-semibold truncate ${!selectedOrg ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-200'
									}`}>
									All Orgs
								</h3>
								<p className="text-xs text-slate-500 dark:text-slate-400 truncate">
									{stats?.totalRepos || 0} repos
								</p>
							</div>
							{!selectedOrg && viewMode === 'list' && (
								<motion.div layoutId="active-indicator" className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
							)}
						</motion.button>

						{filteredOrgs.map((org) => (
							<OrgItem
								key={org.login}
								org={org}
								isSelected={selectedOrg === org.login}
								onClick={() => onSelectOrg(org.login)}
								viewMode={viewMode}
							/>
						))}
					</AnimatePresence>
				</div>
			</div>

			{/* User Profile Footer */}
			<div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
				<div className="flex items-center gap-3">
					<img
						src={user?.avatar_url}
						alt={user?.login}
						className="w-10 h-10 rounded-full ring-2 ring-white dark:ring-slate-700 shadow-sm"
					/>
					<div className="flex-1 min-w-0">
						<h4 className="font-semibold text-slate-900 dark:text-white truncate">
							{user?.name || user?.login}
						</h4>
						<p className="text-xs text-slate-500 dark:text-slate-400 truncate">
							@{user?.login}
						</p>
					</div>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger asChild>
							<button className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors">
								<Settings size={18} />
							</button>
						</DropdownMenu.Trigger>
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								className="min-w-[180px] bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 p-1 z-50 animate-in fade-in zoom-in-95 duration-200"
								sideOffset={5}
							>
								<DropdownMenu.Item
									className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-300 rounded-lg cursor-pointer outline-none"
									onSelect={() => setIsSettingsOpen(true)}
								>
									<Settings size={14} />
									Settings
								</DropdownMenu.Item>
								<DropdownMenu.Item className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-300 rounded-lg cursor-pointer outline-none">
									<Shield size={14} />
									Security
								</DropdownMenu.Item>
								<DropdownMenu.Separator className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
								<DropdownMenu.Item
									className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg cursor-pointer outline-none"
									onClick={() => window.location.href = '/logout'}
								>
									Sign Out
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu.Root>
				</div>
			</div>

			<SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
		</div>
	)
}

function OrgItem({ org, isSelected, onClick, viewMode }) {
	// Calculate total repos if available, otherwise fallback
	const totalRepos = (org.public_repos || 0) + (org.total_private_repos || 0)
	const isGrid = viewMode === 'grid'

	return (
		<motion.button
			layout
			initial={{ opacity: 0, scale: 0.95 }}
			animate={{ opacity: 1, scale: 1 }}
			whileHover={{ scale: 1.02 }}
			whileTap={{ scale: 0.98 }}
			onClick={onClick}
			title={org.description || org.login} // Tooltip for full details
			className={`group relative w-full flex items-center gap-3 rounded-xl transition-all border ${isSelected
				? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 shadow-sm'
				: 'bg-white dark:bg-slate-800/50 border-transparent hover:border-indigo-100 dark:hover:border-indigo-900 hover:shadow-sm'
				} ${isGrid ? 'flex-col text-center p-4 min-h-[140px] justify-center' : 'p-3'}`}
		>
			<img
				src={org.avatar_url}
				alt={org.login}
				className={`rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700 group-hover:ring-indigo-200 dark:group-hover:ring-indigo-800 transition-all ${isGrid ? 'w-14 h-14 mb-3' : 'w-10 h-10'}`}
			/>

			<div className={`flex-1 min-w-0 ${isGrid ? 'w-full flex flex-col items-center' : 'text-left'}`}>
				<h3 className={`font-semibold truncate w-full ${isSelected ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-200'
					} ${isGrid ? 'text-sm' : 'text-base'}`}>
					{org.login}
				</h3>

				{!isGrid && (
					<p className="text-xs text-slate-500 dark:text-slate-400 truncate w-full">
						{org.description || 'No description'}
					</p>
				)}

				{/* Repo Count Badge */}
				<div className={`mt-1.5 flex items-center gap-1 ${isGrid ? 'justify-center flex-wrap' : ''}`}>
					<span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${isSelected
						? 'bg-indigo-100/50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
						: 'bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
						}`}>
						{totalRepos} Repos
					</span>
					{org.total_private_repos > 0 && (
						<span
							className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30 flex items-center gap-1"
							title={`${org.total_private_repos} Private Repositories`}
						>
							<Shield size={10} />
							{org.total_private_repos}
						</span>
					)}
				</div>
			</div>

			{isSelected && !isGrid && (
				<motion.div
					layoutId="active-indicator"
					className="absolute right-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-indigo-500"
				/>
			)}

			{!isSelected && !isGrid && (
				<ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
			)}
		</motion.button>
	)
}
