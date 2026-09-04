import { memo } from 'react'
import { AlertCircle, Archive, Lock, Search, Plus, Download } from 'lucide-react'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { EmptyState as UIEmptyState } from '../ui/EmptyState'

/** Full-bleed overlay shown while the page is refreshing the repo list. */
export function LoadingState() {
	return (
		<div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-sm rounded-2xl transition-all duration-[var(--ds-duration)]">
			<Spinner size="xl" tone="primary" label="Loading repositories" />
			<p className="mt-4 text-slate-600 dark:text-slate-300 font-medium">
				Loading repositories...
			</p>
		</div>
	)
}

/**
 * Auth-expired and generic error states share the same slot. The auth
 * variant gets its own visual (amber lock + copy); `BACKEND_UNAVAILABLE`
 * also appends the "how to fix" hint block.
 */
export function ErrorState({ error, errorInfo, onRefresh, onLogin }) {
	if (errorInfo?.type === 'AUTHENTICATION') {
		return (
			<div className="flex flex-col items-center justify-center py-20">
				<div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mb-4">
					<Lock className="w-8 h-8 text-amber-700 dark:text-amber-400" />
				</div>
				<p className="text-slate-700 dark:text-slate-300 font-medium text-center mb-2">Session Expired</p>
				<p className="text-slate-500 dark:text-slate-400 text-sm text-center max-w-md mb-4">
					Your session expired. Sign in again to see your repositories.
				</p>
				{onLogin && (
					<Button variant="primary" onClick={onLogin}>Sign in again</Button>
				)}
			</div>
		)
	}

	return (
		<div className="flex flex-col items-center justify-center py-20">
			<AlertCircle className="w-10 h-10 mb-4 text-rose-500 dark:text-rose-400" />
			<p className="text-center max-w-md text-rose-600 dark:text-rose-400">{error}</p>
			{/* Terminal instructions only make sense to someone running from a
			    checkout. The packaged Windows build ships to people who have
			    neither, so this stays behind the dev guard. */}
			{errorInfo?.type === 'BACKEND_UNAVAILABLE' && import.meta.env.DEV && (
				<div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg max-w-lg">
					<p className="text-amber-800 dark:text-amber-200 text-sm font-medium mb-2">
						How to fix this:
					</p>
					<ol className="text-amber-700 dark:text-amber-300 text-sm list-decimal list-inside space-y-1">
						<li>Open a terminal in the project root</li>
						<li>Run <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">npm run dev:server</code> to start the backend</li>
						<li>Or run <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">npm run dev:all</code> to start both frontend and backend</li>
					</ol>
				</div>
			)}
			<Button variant="secondary" className="mt-4" onClick={onRefresh}>Try Again</Button>
		</div>
	)
}

/**
 * Two empty states: "no repos at all" (pitch the create/import CTAs)
 * versus "filters hide everything" (pitch clearing filters).
 */
export function EmptyState({ hasRepos, onCreateRepo, onImport, onClearFilters, pagedSearch = false, onSearchAllPages }) {
	if (!hasRepos) {
		return (
			<div data-testid="empty-state" className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-slate-400">
				<div className="w-16 h-16 mb-5 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
					<Archive className="w-8 h-8 text-brand-500 dark:text-[color:var(--ds-accent-brand-dark)]" />
				</div>
				<h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">No repositories yet</h2>
				<p className="text-sm opacity-80 mb-6 text-center max-w-md">
					Create a new repository on GitHub, or import one from Azure DevOps — both take under a minute.
				</p>
				<div className="flex flex-col sm:flex-row gap-2.5">
					<Button variant="primary" onClick={onCreateRepo}>
						<Plus className="w-4 h-4 mr-1.5" />
						Create your first repo
					</Button>
					<Button variant="secondary" onClick={onImport}>
						<Download className="w-4 h-4 mr-1.5" />
						Import from Azure DevOps
					</Button>
				</div>
			</div>
		)
	}

	// Text search is client-side over the page on screen. Saying "no
	// matches" when the match sits on page two blamed the filters for a
	// pagination artefact, so the state names its scope and offers the rest.
	if (pagedSearch && onSearchAllPages) {
		return (
			<UIEmptyState
				icon={Search}
				title="No matches on this page"
				description="Search looked at the repositories on this page only. Load every page to search your whole account."
				action={{ label: 'Search all pages', onClick: onSearchAllPages }}
			/>
		)
	}
	return (
		<UIEmptyState
			icon={Search}
			title="No matches"
			description="No repositories match your current filters."
			action={{ label: 'Clear filters', onClick: onClearFilters }}
		/>
	)
}

export const TooltipButton = memo(function TooltipButton({ icon: IconComp, label, onClick, className = "" }) {
	return (
		<button
			onClick={onClick}
			className={`p-2 rounded-full hover:bg-white/10 dark:hover:bg-slate-900/10 transition-colors ${className}`}
			title={label}
		>
			<IconComp className="w-4 h-4" />
		</button>
	)
})
