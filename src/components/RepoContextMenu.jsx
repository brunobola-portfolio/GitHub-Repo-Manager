import { memo, useMemo } from 'react'
import ContextMenu from './ui/ContextMenu'
import { Copy, Rocket, Sparkles, Package } from 'lucide-react'
import { repoActions } from '../actions/repoActions'

/**
 * RepoContextMenu — reads the action registry and renders items grouped
 * by intent. Single-repo and batch modes use different filters.
 *
 * Props:
 *  - repo: the right-clicked repo (single mode)
 *  - selectedRepos: array (batch mode if length > 1)
 *  - x, y: cursor coordinates
 *  - onClose: close handler
 *  - onAction: (actionId, target) => void  — caller dispatches via runAction
 */
const resolve = (val, target) => (typeof val === 'function' ? val(target) : val)

function buildItem(actionId, target, onAction) {
	const a = repoActions[actionId]
	if (!a) return null
	const applicable = a.isApplicable ? a.isApplicable(target) : true
	return {
		id: a.id,
		label: resolve(a.label, target),
		description: resolve(a.description, target),
		icon: resolve(a.icon, target),
		disabled: !applicable,
		tooltip: !applicable ? 'Not available for this repo' : null,
		intent: a.intent,
		danger: a.intent === 'destructive',
		onClick: () => onAction(a.id, target),
	}
}

function buildSingleItems(repo, onAction) {
	const item = (id) => buildItem(id, repo, onAction)

	return [
		{ type: 'header', label: repo.name },
		item('open_detail'),
		item('open_repo_settings'),
		item('open_on_github'),
		{ type: 'separator' },
		{
			label: 'Copy Clone URL',
			icon: Copy,
			children: [item('copy_clone_https'), item('copy_clone_ssh'), item('copy_clone_gh')].filter(Boolean),
		},
		{ type: 'separator' },
		{
			label: 'Migration',
			icon: Rocket,
			children: [item('migrate'), item('migration_history'), item('dry_run')].filter(Boolean),
		},
		{
			label: 'AI',
			icon: Sparkles,
			children: [
				item('ai_commit'),
				item('ai_pr'),
				item('ai_quality'),
				item('ai_suggest_name_desc'),
				item('ai_compare'),
				item('ai_security'),
			].filter(Boolean),
		},
		{
			label: 'Management',
			icon: Package,
			children: [item('transfer'), item('mirror'), item('sync'), item('export_meta')].filter(Boolean),
		},
		{ type: 'separator' },
		item('visibility'),
		item('archive'),
		{ type: 'separator' },
		item('delete'),
	].filter(Boolean)
}

function buildBatchItems(repos, onAction) {
	const item = (id) => buildItem(id, repos, onAction)

	return [
		{ type: 'header', label: `${repos.length} repositories selected` },
		item('archive_selected'),
		item('ai_batch_index_selected'),
		{ type: 'separator' },
		{
			label: 'Migration',
			icon: Rocket,
			children: [item('migrate_selected'), item('dry_run_selected')].filter(Boolean),
		},
		{
			label: 'Management',
			icon: Package,
			children: [item('transfer_selected'), item('export_meta_selected')].filter(Boolean),
		},
		{ type: 'separator' },
		item('delete_selected'),
	].filter(Boolean)
}

const RepoContextMenu = memo(function RepoContextMenu({ repo, selectedRepos = [], x, y, onClose, onAction }) {
	const isBatch = selectedRepos.length > 1
	const items = useMemo(
		() => (isBatch ? buildBatchItems(selectedRepos, onAction) : buildSingleItems(repo, onAction)),
		[isBatch, repo, selectedRepos, onAction]
	)

	return <ContextMenu items={items} x={x} y={y} onClose={onClose} />
})

export default RepoContextMenu
