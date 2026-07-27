import { useState, memo } from 'react'
import {
	Building2, Plus, Search,
	Settings, Shield,
	ChevronRight, LayoutGrid, List,
	Globe, Folder
} from 'lucide-react'
import { formatNumber, formatCompact } from '../utils/format'
import { getOrgRepoCount } from '../utils/orgRepoCount'
import { motion, AnimatePresence } from 'framer-motion'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { TAP, EASE } from './ui/motion'
import { useModal } from '../hooks/useModal'
import { Input } from './ui/form'

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
	const { openModal } = useModal()

	const filteredOrgs = orgs.filter(org =>
		org.login?.toLowerCase()?.includes(searchTerm.toLowerCase())
	)

	return (
		<div className="h-full flex flex-col bg-transparent w-full transition-all duration-[var(--ds-duration-slow)]">
			{/* Header */}
			<div className="p-5 border-b border-slate-200/60 dark:border-slate-700/40">
				<div className="flex items-center justify-between mb-4">
					<h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
						<div className="p-2 rounded-xl bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] text-white shadow-md">
							<Building2 className="w-4 h-4" />
						</div>
						Organizations
					</h2>
					<div className="flex items-center gap-1">
						<button
							onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
							className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-colors duration-200"
							title={viewMode === 'list' ? "Switch to Grid View" : "Switch to List View"}
							aria-label={viewMode === 'list' ? "Switch to Grid View" : "Switch to List View"}
						>
							{viewMode === 'list' ? <LayoutGrid size={18} /> : <List size={18} />}
						</button>
						<button
							onClick={onCreateOrg}
							className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-colors duration-200"
							title="Add Organization"
							aria-label="Add Organization"
						>
							<Plus size={18} />
						</button>
					</div>
				</div>

				{/* Search */}
				<Input
					leadingIcon={Search}
					type="text"
					placeholder="Search orgs..."
					value={searchTerm}
					onChange={(e) => setSearchTerm(e.target.value)}
					aria-label="Search organizations"
				/>
			</div>

			{/* Org List */}
			<div className="flex-1 overflow-y-auto p-3 ds-scrollbar">
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
								? 'bg-indigo-100 dark:bg-indigo-900/40 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]'
								: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
								} ${viewMode === 'grid' ? 'w-12 h-12 mb-2' : 'w-10 h-10'}`}>
								<LayoutGrid size={viewMode === 'grid' ? 24 : 20} />
							</div>
							<div className={`flex-1 ${viewMode === 'grid' ? 'w-full' : 'text-left'}`}>
								<h3 className={`font-semibold truncate ${!selectedOrg ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-200'
									}`}>
									All Orgs
								</h3>
								<p className="text-xs text-slate-600 dark:text-slate-400 truncate">
									{formatNumber(stats?.totalRepos || 0)} repos
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
			<div className="p-4 border-t border-slate-200/50 dark:border-slate-700/40 bg-gradient-to-r from-slate-50/80 to-white/80 dark:from-slate-800/80 dark:to-slate-900/80 backdrop-blur-md">
				<div className="flex items-center gap-3">
					<img
						src={user?.avatar_url}
						alt={user?.login}
						className="w-11 h-11 rounded-xl ring-2 ring-white dark:ring-slate-700 shadow-lg shadow-slate-300/50 dark:shadow-black/40"
					/>
					<div className="flex-1 min-w-0">
						<h4 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
							{user?.name || user?.login}
						</h4>
						<p className="text-xs text-slate-500 dark:text-slate-400 truncate">
							@{user?.login}
						</p>
					</div>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger asChild>
							<button
								type="button"
								aria-label="Open user settings menu"
								className="p-2.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl transition-colors duration-200"
							>
								<Settings size={18} aria-hidden="true" />
							</button>
						</DropdownMenu.Trigger>
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								className="min-w-[200px] bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-2xl shadow-[var(--ds-shadow-overlay)] border border-slate-200/70 dark:border-slate-700/60 p-1.5 z-[var(--ds-z-popover)] animate-in fade-in zoom-in-95 duration-200"
								sideOffset={8}
							>
								<DropdownMenu.Item
									className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-300 data-[highlighted]:bg-indigo-50 dark:data-[highlighted]:bg-indigo-900/20 data-[highlighted]:text-indigo-700 dark:data-[highlighted]:text-indigo-300 rounded-xl cursor-pointer outline-none transition-colors"
									onSelect={() => openModal('showSettings')}
								>
									<Settings size={15} />
									Settings
								</DropdownMenu.Item>
								<DropdownMenu.Item
									className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-300 data-[highlighted]:bg-indigo-50 dark:data-[highlighted]:bg-indigo-900/20 data-[highlighted]:text-indigo-700 dark:data-[highlighted]:text-indigo-300 rounded-xl cursor-pointer outline-none transition-colors"
									onSelect={() => window.open('https://github.com/settings/security', '_blank', 'noopener,noreferrer')}
								>
									<Shield size={15} />
									Security
								</DropdownMenu.Item>
								<DropdownMenu.Separator className="h-px bg-slate-200/70 dark:bg-slate-700/70 my-1.5" />
								<DropdownMenu.Item
									className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 data-[highlighted]:bg-red-50 dark:data-[highlighted]:bg-red-900/20 data-[highlighted]:text-red-800 dark:data-[highlighted]:text-red-300 rounded-xl cursor-pointer outline-none transition-colors"
									onSelect={() => {
										fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
											.finally(() => window.location.reload())
									}}
								>
									Sign Out
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu.Root>
				</div>
			</div>

		</div>
	)
}

const OrgItem = memo(function OrgItem({ org, isSelected, onClick, viewMode }) {
	// Calculate total repos if available, otherwise fallback
	const totalRepos = getOrgRepoCount(org)
	const isGrid = viewMode === 'grid'
	const isPersonal = org.isPersonal === true

	return (
		<motion.button
			layout
			initial={{ opacity: 0, scale: 0.95 }}
			animate={{ opacity: 1, scale: 1 }}
			whileHover={{
				transition: { duration: 0.2, ease: "easeOut" }
			}}
			whileTap={TAP}
			onClick={onClick}
			title={org.description || org.login}
			className={`group relative w-full flex items-center gap-3 rounded-xl transition-all duration-[var(--ds-duration-slow)] border ${
				isSelected
					? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800 shadow-lg'
					: 'bg-white/80 dark:bg-slate-800/60 border-slate-200/50 dark:border-slate-700/40 hover:border-indigo-200 dark:hover:border-indigo-800/60 hover:shadow-xl'
			} ${isGrid ? 'flex-col text-center p-5 min-h-[180px] justify-start' : 'p-3.5'}`}
		>
			{/* Animated gradient overlay on hover (selected state) */}
			{isSelected && (
				<motion.div
					className="absolute inset-0 rounded-xl bg-indigo-500/5 dark:bg-indigo-500/10"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.3 }}
				/>
			)}

			{/* Avatar with improved ring effect */}
			<div className="relative">
				<img
					src={org.avatar_url}
					alt={org.login}
					className={`rounded-xl object-cover ring-2 transition-all duration-[var(--ds-duration-slow)] ${
						isSelected
							? 'ring-indigo-300 dark:ring-indigo-600 shadow-lg'
							: 'ring-slate-200 dark:ring-slate-700 group-hover:ring-indigo-300 dark:group-hover:ring-indigo-700/60 group-hover:shadow-md'
					} ${isGrid ? 'w-16 h-16 mb-3' : 'w-11 h-11'}`}
				/>

				{/* Personal Account Badge */}
				{isPersonal && (
					<div className="absolute -bottom-1 -right-1 bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] text-white text-[8px] font-bold px-1.5 py-0.5 rounded-md shadow-md">
						YOU
					</div>
				)}

				{/* Active indicator with pulse */}
				{isSelected && !isPersonal && (
					<motion.div
						className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-indigo-500"
						animate={{ scale: [1, 1.2, 1] }}
						transition={{ duration: 2, repeat: Infinity }}
					>
						<div className="absolute inset-0 rounded-full bg-indigo-500 opacity-75" />
					</motion.div>
				)}
			</div>

			<div className={`flex-1 min-w-0 relative z-10 ${isGrid ? 'w-full flex flex-col items-center' : 'text-left'}`}>
				{/* Organization name */}
				<h3 className={`font-semibold truncate w-full ${
					isSelected ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-800 dark:text-slate-100'
				} ${isGrid ? 'text-sm mb-1' : 'text-base mb-0.5'}`}>
					{org.login}
				</h3>

				{/* Description (list mode only) */}
				{!isGrid && (
					<p className="text-xs text-slate-500 dark:text-slate-400 truncate w-full mb-2">
						{org.description || 'No description'}
					</p>
				)}

				{/* Improved stats grid */}
				<div className={`flex items-center gap-2 mt-2 ${isGrid ? 'flex-col w-full' : 'flex-row flex-wrap'}`}>
					{/* Total Repos */}
					<div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
						isSelected
							? 'bg-indigo-100/60 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60'
							: 'bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600/50 group-hover:border-indigo-200 dark:group-hover:border-indigo-800/40'
					}`}>
						<Folder className="w-3 h-3" />
						<span>{formatNumber(totalRepos)}</span>
					</div>

					{/* Public Repos */}
					{org.public_repos > 0 && (
						<div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
							isSelected
								? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
								: 'bg-emerald-50/50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30'
						}`}>
							<Globe className="w-3 h-3" />
							<span>{formatCompact(org.public_repos)}</span>
						</div>
					)}

					{/* Private Repos */}
					{org.total_private_repos > 0 && (
						<div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
							isSelected
								? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
								: 'bg-amber-50/50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/30'
						}`}>
							<Shield className="w-3 h-3" />
							<span>{formatCompact(org.total_private_repos)}</span>
						</div>
					)}
				</div>
			</div>

			{/* Selection indicator with improved animation */}
			{isSelected && !isGrid && (
				<motion.div
					layoutId="active-indicator"
					className="absolute right-3 top-1/2 -translate-y-1/2"
					initial={{ scale: 0 }}
					animate={{ scale: 1 }}
					transition={{ duration: 0.2, ease: EASE.standard }}
				>
					<div className="relative">
						<div className="w-2 h-2 rounded-full bg-indigo-500" />
						<div className="absolute inset-0 w-2 h-2 rounded-full bg-indigo-500 opacity-75" />
					</div>
				</motion.div>
			)}

			{/* Chevron reveal on hover (opacity only — no translate per
			    premium contract). The parent's bg/border change carries
			    the directional affordance instead of motion. */}
			{!isSelected && !isGrid && (
				<ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
			)}
		</motion.button>
	)
}, (prevProps, nextProps) => {
	// Only re-render if these props change
	return (
		prevProps.org.login === nextProps.org.login &&
		prevProps.org.public_repos === nextProps.org.public_repos &&
		prevProps.org.total_private_repos === nextProps.org.total_private_repos &&
		prevProps.isSelected === nextProps.isSelected &&
		prevProps.viewMode === nextProps.viewMode
	)
})
