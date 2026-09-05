import { useState, useEffect } from 'react'
import { ArrowRight, Building2, GitFork, AlertTriangle, ArrowRightLeft, Copy, Loader2, CheckCircle2, CheckCircle, XCircle } from 'lucide-react'
import { Spinner } from './ui/Spinner'
import { Button } from './ui/Button'
import { Modal, ModalFooter } from './ui/Modal'
import { InsightCard } from './ui/InsightCard'
import { StatBar } from './ui/StatBar'
import { EmptyState } from './ui/EmptyState'
import { Checkbox } from './ui/form'
import { ConflictPanel } from './ConflictPanel'
import { useDebounce } from '../hooks/useDebounce'
import { API_ENDPOINTS } from '../config'
import { apiCall } from '../utils/api'
import { getOrgRepoCount } from '../utils/orgRepoCount'

export function TransferModal({
	isOpen,
	onClose,
	repos = [],
	orgs = [],
	onTransfer,
	onMirror,
	isPerforming = false,
	progress = null,
	initialAction = 'transfer' // 'transfer' | 'mirror' — entry-point intent
}) {
	const [targetOrg, setTargetOrg] = useState('')
	const [action, setAction] = useState(initialAction) // 'transfer' | 'mirror'
	const [formError, setFormError] = useState('')
	const [conflicts, setConflicts] = useState(null) // null = unchecked, {} = checked
	const [checkingConflicts, setCheckingConflicts] = useState(false)
	const [resolutions, setResolutions] = useState({}) // { repoName: { action, newName? } }
	const [dryRun, setDryRun] = useState(false)
	const debouncedTargetOrg = useDebounce(targetOrg, 500)

	// The modal stays mounted across open/close, so useState only captures the
	// first initialAction. Re-sync to the entry-point intent each time it opens
	// (e.g. "Mirror / Fork" must land on mirror mode even after a prior transfer).
	/* eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync to the entry-point intent on open */
	useEffect(() => { if (isOpen) setAction(initialAction) }, [isOpen, initialAction])

	// Check conflicts when (debounced) targetOrg / repos / action changes
	/* eslint-disable react-hooks/set-state-in-effect -- targetOrg/action change drives conflict probe */
	useEffect(() => {
		if (!debouncedTargetOrg || !repos.length || action !== 'transfer') {
			setConflicts(null)
			setResolutions({})
			return
		}

		let cancelled = false
		;(async function checkConflicts() {
			setCheckingConflicts(true)
			setConflicts(null)
			setResolutions({})
			try {
				if (cancelled) return
				const data = await apiCall(API_ENDPOINTS.checkConflicts, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						repos: repos.map(r => r.full_name),
						targetOrg: debouncedTargetOrg
					})
				})
				if (!cancelled) {
					setConflicts(data.conflicts || {})
				}
			} catch {
				// Conflict check is best-effort — the transfer RPC will re-validate
					// server-side on submit, so a failed probe just means we
					// can't show pre-flight warnings here.
					if (!cancelled) setConflicts({})
					// (was: silently fail — transfer still catches conflicts at execution time)
			} finally {
				if (!cancelled) setCheckingConflicts(false)
			}
		})()

		return () => { cancelled = true }
	}, [debouncedTargetOrg, repos, action])
	/* eslint-enable react-hooks/set-state-in-effect */

	// Detect if all selected repos belong to the same owner as the target
	const repoOwners = [...new Set(repos.map(r => r.owner?.login).filter(Boolean))]
	const isTransferToSelf = action === 'transfer' && repoOwners.length === 1 && targetOrg === repoOwners[0]

	const handleSubmit = () => {
		if (!targetOrg) {
			setFormError('Select a target organization')
			return
		}
		if (isTransferToSelf) {
			setFormError('Cannot transfer repositories to their current owner')
			return
		}

		// Check all conflicts are resolved
		if (conflicts) {
			const unresolvedConflicts = repos.filter(r => conflicts[r.name]?.exists && !resolutions[r.name])
			if (unresolvedConflicts.length > 0) {
				setFormError(`Resolve ${unresolvedConflicts.length} conflict(s) before transferring`)
				return
			}
		}

		setFormError('')

		// Build strategies map from resolutions (keyed by full_name)
		const strategies = {}
		for (const repo of repos) {
			const resolution = resolutions[repo.name]
			if (resolution) {
				strategies[repo.full_name] = resolution
			}
		}

		if (action === 'transfer') {
			onTransfer?.(repos.map(r => r.full_name), targetOrg, strategies, { dryRun })
		} else {
			onMirror?.(repos.map(r => r.full_name), targetOrg, { dryRun })
		}
	}

	const footerSummary = (() => {
		const skipped = Object.values(resolutions).filter(r => r.action === 'skip').length
		const replaced = Object.values(resolutions).filter(r => r.action === 'replace').length
		const renamed = Object.values(resolutions).filter(r => r.action === 'rename').length
		const transferCount = repos.length - skipped

		if (replaced || renamed || skipped) {
			const parts = []
			if (transferCount > 0) parts.push(`${transferCount} transfer`)
			if (replaced > 0) parts.push(`${replaced} replace`)
			if (renamed > 0) parts.push(`${renamed} rename`)
			if (skipped > 0) parts.push(`${skipped} skip`)
			return parts.join(', ')
		}
		return `${repos.length} repo${repos.length !== 1 ? 's' : ''} will be ${action === 'transfer' ? 'transferred' : 'mirrored'}${dryRun ? ' (dry-run)' : ''}`
	})()

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={action === 'mirror' ? 'Mirror Repositories' : 'Transfer Repositories'}
			subtitle={repos.length ? `${repos.length} repositor${repos.length !== 1 ? 'ies' : 'y'} selected` : undefined}
			icon={action === 'mirror' ? Copy : ArrowRightLeft}
			size="xl"
			staggerChildren={!isPerforming}
			mobileVariant="sheet"
			closeOnBackdrop={!isPerforming} disableEscape={isPerforming}
			footer={
				<ModalFooter align="between">
					<span className="text-sm text-slate-500 dark:text-slate-400">
						{footerSummary}
					</span>
					<div className="flex items-center gap-3">
						<Button variant="ghost" onClick={onClose} disabled={isPerforming}>
							Cancel
						</Button>
						<Button
							variant={action === 'transfer' ? 'primary' : 'secondary'}
							onClick={handleSubmit}
							disabled={!targetOrg || isPerforming || checkingConflicts || (conflicts && repos.some(r => conflicts[r.name]?.exists && !resolutions[r.name]))}
						>
							{isPerforming ? 'Processing...' : (dryRun ? 'Simulate' : (action === 'transfer' ? 'Transfer' : 'Mirror'))}
						</Button>
					</div>
				</ModalFooter>
			}
		>
			<div className="space-y-5">
				{/* Action Toggle */}
				<InsightCard hover={false} className="p-1">
					<div className="flex gap-2">
						<button
							onClick={() => setAction('transfer')}
							className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${
								action === 'transfer'
									? 'bg-white dark:bg-slate-800 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] ds-elevation-sm'
									: 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
							} ds-focus-ring`}
						>
							<ArrowRightLeft className="w-4 h-4" />
							Transfer (Move)
						</button>
						<button
							onClick={() => setAction('mirror')}
							className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all ${
								action === 'mirror'
									? 'bg-white dark:bg-slate-800 text-brand-600 dark:text-brand-400 ds-elevation-sm'
									: 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
							} ds-focus-ring`}
						>
							<Copy className="w-4 h-4" />
							Mirror (Fork)
						</button>
					</div>
				</InsightCard>

				{/* Info Box */}
				<InsightCard tone={action === 'transfer' ? 'warning' : 'info'} hover={false}>
					<div className="flex gap-3">
						<AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-500 dark:text-amber-400" />
						<div className="text-sm text-slate-700 dark:text-slate-300">
							{action === 'transfer' ? (
								<>
									<strong>Transfer</strong> will move repositories to the target organization.
									The original URLs will redirect automatically.
								</>
							) : (
								<>
									<strong>Mirror</strong> creates independent copies (forks) in the target
									organization. Original repos remain unchanged.
								</>
							)}
						</div>
					</div>
				</InsightCard>

				{/* Target Organization */}
				<InsightCard hover={false}>
					<p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
						Target Organization
					</p>
					{orgs.length > 0 ? (
						<div className="grid grid-cols-2 gap-2">
							{orgs.map(org => (
								<button
									key={org.login}
									onClick={() => {
										setTargetOrg(org.login)
										setFormError('')
									}}
									className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
										targetOrg === org.login
											? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
											: 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
									} ds-focus-ring`}
								>
									<img
										src={org.avatar_url}
										alt={org.login}
										className="w-8 h-8 rounded-lg"
									/>
									<div className="text-left">
										<div className="font-medium text-slate-900 dark:text-slate-100">{org.login}</div>
										<div className="text-xs text-slate-500 dark:text-slate-400">
											{getOrgRepoCount(org)} repos
										</div>
									</div>
								</button>
							))}
						</div>
					) : (
						<EmptyState
							icon={Building2}
							title="No organizations"
							description="You're not a member of any GitHub organization that can receive transfers."
							action={{
								label: "Create an organization on GitHub",
								href: "https://github.com/organizations/plan",
							}}
						/>
					)}
					{formError && (
						<p className="mt-3 flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400">
							<AlertTriangle className="w-4 h-4" />
							<span>{formError}</span>
						</p>
					)}
				</InsightCard>

				{/* Repository Preview with Conflict Status */}
				<div>
					<label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
						Repositories to {action === 'transfer' ? 'Transfer' : 'Mirror'}
					</label>
					<InsightCard hover={false} className="p-0 overflow-hidden">
						<div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
							{repos.map(repo => {
								const conflict = conflicts?.[repo.name]
								const hasConflict = conflict?.exists === true
								const resolution = resolutions[repo.name]

								return (
									<div key={repo.id} className="p-3">
										<div className="flex items-center gap-3">
											{checkingConflicts ? (
												<Spinner size="sm" tone="muted" className="shrink-0" />
											) : hasConflict ? (
												<AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
											) : conflicts ? (
												<CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
											) : (
												<GitFork className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
											)}
											<div className="flex-1 min-w-0">
												<div className="font-medium text-slate-900 dark:text-slate-100 truncate">{repo.name}</div>
												<div className="text-xs text-slate-500 dark:text-slate-400 truncate">{repo.full_name}</div>
											</div>
											{targetOrg && !hasConflict && (
												<div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
													<ArrowRight className="w-4 h-4" />
													<span className="text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] font-medium">{targetOrg}/{repo.name}</span>
												</div>
											)}
											{hasConflict && !resolution && (
												<span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Conflict</span>
											)}
										</div>
										{hasConflict && (
											<ConflictPanel
												conflict={conflict}
												repoName={repo.name}
												resolution={resolution}
												onResolve={(r) => setResolutions(prev => {
													const next = { ...prev }
													if (r === null) { delete next[repo.name] }
													else { next[repo.name] = r }
													return next
												})}
											/>
										)}
									</div>
								)
							})}
						</div>
					</InsightCard>
				</div>

				{/* Progress */}
				{progress && (
					<InsightCard hover={false} tone={progress.status === 'error' ? 'danger' : progress.status === 'success' ? 'success' : 'info'}>
						<div className="space-y-3">
							<StatBar
								label={progress.status === 'running' ? 'Processing...' : progress.status === 'success' ? 'Completed' : 'Failed'}
								value={progress.current}
								max={progress.total}
								gradient={progress.status === 'error' ? 'accent' : progress.status === 'success' ? 'success' : 'primary'}
								animated={false}
								showValue
							/>
							{progress.message && (
								<p className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
									{progress.status === 'running' && <Spinner size="sm" />}
									{progress.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-500" />}
									{progress.status === 'error' && <XCircle className="w-4 h-4 text-rose-500" />}
									{progress.message}
								</p>
							)}
							{progress.results?.length > 0 && (
								<div className="max-h-40 overflow-y-auto space-y-1 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
									{progress.results.map((r, i) => (
										<div
											key={i}
											className={`text-xs px-2 py-1 rounded flex items-center gap-2 ${
												r.success
													? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
													: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
											}`}
										>
											{r.success ? (
												<CheckCircle className="w-3 h-3" />
											) : (
												<XCircle className="w-3 h-3" />
											)}
											<span className="font-medium truncate">{r.name}</span>
											{r.error && (
												<span className="text-rose-600 dark:text-rose-400 truncate ml-auto">{r.error}</span>
											)}
										</div>
									))}
								</div>
							)}
						</div>
					</InsightCard>
				)}

				{/* Dry-run toggle */}
				<label htmlFor="transfer-dry-run" className="flex items-center gap-2 cursor-pointer px-1">
					<Checkbox
						id="transfer-dry-run"
						checked={dryRun}
						onChange={(e) => setDryRun(e.target.checked)}
					/>
					<span className="text-sm text-slate-600 dark:text-slate-400">Simulate transfer (dry-run)</span>
				</label>
			</div>
		</Modal>
	)
}
