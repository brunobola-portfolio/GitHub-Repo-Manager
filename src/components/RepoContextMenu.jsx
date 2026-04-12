import { memo } from 'react'
import ContextMenu from './ui/ContextMenu'
import {
	ExternalLink, Copy, Settings, Rocket, Sparkles, Package,
	Lock, Unlock, Archive, Trash2, RefreshCw, Wand2, GitCompare, Shield,
	BarChart3, Lightbulb, ArrowRightLeft, GitFork, Download, Upload, History, FlaskConical,
	Globe, KeyRound, Terminal
} from 'lucide-react'

/**
 * RepoContextMenu - Context menu for repository actions
 *
 * Props:
 * - repo: single repo object (null if batch)
 * - selectedRepos: array of selected repos (for batch mode)
 * - x, y: position coordinates
 * - onClose: close handler
 * - onAction: callback (action, data) => void
 */
const RepoContextMenu = memo(function RepoContextMenu({ repo, selectedRepos = [], x, y, onClose, onAction }) {
	const isBatch = selectedRepos.length > 1

	const copyToClipboard = (text) => {
		navigator.clipboard.writeText(text)
	}

	const singleRepoItems = repo ? [
		{ type: 'header', label: repo.name },
		{
			label: 'Open on GitHub',
			icon: ExternalLink,
			onClick: () => window.open(repo.html_url, '_blank')
		},
		{
			label: 'Copy Clone URL',
			icon: Copy,
			children: [
				{ label: 'HTTPS', icon: Globe, onClick: () => copyToClipboard(repo.clone_url) },
				{ label: 'SSH', icon: KeyRound, onClick: () => copyToClipboard(repo.ssh_url) },
				{ label: 'GitHub CLI', icon: Terminal, onClick: () => copyToClipboard(`gh repo clone ${repo.full_name}`) }
			]
		},
		{
			label: 'Settings',
			icon: Settings,
			onClick: () => window.open(`${repo.html_url}/settings`, '_blank')
		},
		{ type: 'separator' },
		{
			label: 'Migration',
			icon: Rocket,
			children: [
				{ label: 'Migrate to GitHub', icon: Upload, onClick: () => onAction('migrate', repo) },
				{ label: 'Migration History', icon: History, onClick: () => onAction('migrationHistory', repo) },
				{ label: 'Dry-Run (Simulate)', icon: FlaskConical, onClick: () => onAction('dryRun', repo) }
			]
		},
		{
			label: 'AI',
			icon: Sparkles,
			children: [
				{ label: 'Generate Commit Message', icon: Wand2, onClick: () => onAction('aiCommit', repo) },
				{ label: 'Quality Report', icon: BarChart3, onClick: () => onAction('aiQuality', repo) },
				{ label: 'Suggest Name & Description', icon: Lightbulb, onClick: () => onAction('aiSuggest', repo) },
				{ label: 'Compare with Existing', icon: GitCompare, onClick: () => onAction('aiCompare', repo) },
				{ label: 'Security / Secrets Scan', icon: Shield, onClick: () => onAction('aiSecurity', repo) }
			]
		},
		{
			label: 'Management',
			icon: Package,
			children: [
				{ label: 'Transfer to Org', icon: ArrowRightLeft, onClick: () => onAction('transfer', repo) },
				{ label: 'Mirror / Fork', icon: GitFork, onClick: () => onAction('mirror', repo) },
				{
					id: 'sync',
					label: 'Sync Repository',
					icon: RefreshCw,
					disabled: !repo.isMirror,
					tooltip: repo.isMirror ? null : 'Only available for mirrored repos',
					onClick: () => onAction('sync', repo)
				},
				{ label: 'Export Metadata (JSON)', icon: Download, onClick: () => onAction('exportMeta', repo) }
			]
		},
		{ type: 'separator' },
		{
			label: repo.private ? 'Make Public' : 'Make Private',
			icon: repo.private ? Unlock : Lock,
			onClick: () => onAction('visibility', repo)
		},
		{
			label: repo.archived ? 'Unarchive' : 'Archive',
			icon: Archive,
			onClick: () => onAction('archive', repo)
		},
		{ type: 'separator' },
		{
			label: 'Delete Repository',
			icon: Trash2,
			danger: true,
			onClick: () => onAction('delete', repo)
		}
	] : []

	const batchItems = [
		{ type: 'header', label: `${selectedRepos.length} repositories selected` },
		{
			label: `Archive ${selectedRepos.length} repos`,
			icon: Archive,
			onClick: () => onAction('archive_selected', selectedRepos)
		},
		{
			label: 'Batch Index with AI',
			icon: Sparkles,
			onClick: () => onAction('aiBatchIndex_selected', selectedRepos)
		},
		{ type: 'separator' },
		{
			label: 'Migration',
			icon: Rocket,
			children: [
				{ label: `Migrate ${selectedRepos.length} repos`, icon: Upload, onClick: () => onAction('migrate_selected', selectedRepos) },
				{ label: 'Dry-Run (Simulate)', icon: FlaskConical, onClick: () => onAction('dryRun_selected', selectedRepos) }
			]
		},
		{
			label: 'Management',
			icon: Package,
			children: [
				{ label: `Transfer ${selectedRepos.length} repos`, icon: ArrowRightLeft, onClick: () => onAction('transfer_selected', selectedRepos) },
				{ label: 'Export Metadata (JSON)', icon: Download, onClick: () => onAction('exportMeta_selected', selectedRepos) }
			]
		},
		{ type: 'separator' },
		{
			label: `Delete ${selectedRepos.length} repos`,
			icon: Trash2,
			danger: true,
			onClick: () => onAction('delete_selected', selectedRepos)
		}
	]

	const items = isBatch ? batchItems : singleRepoItems

	return (
		<ContextMenu
			items={items}
			x={x}
			y={y}
			onClose={onClose}
		/>
	)
})

export default RepoContextMenu
