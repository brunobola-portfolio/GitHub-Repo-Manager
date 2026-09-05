import {
	Eye, Settings, ExternalLink, Globe, KeyRound, Terminal, History, Shield,
	Lock, Unlock, Archive, ArrowRightLeft, GitFork, RefreshCw, Lightbulb,
	Trash2, Wand2, GitPullRequest, BarChart3, GitCompare, ShieldAlert,
	Upload, FlaskConical, Download, Sparkles, Heart,
} from 'lucide-react'
import { copyToClipboard } from '../utils/clipboard'
import { formatDateTime } from '../utils/format'
import { buildActionCommands } from './buildActionCommands'
import { emitAppEvent, APP_EVENTS } from '../utils/appEvents'

/**
 * Repository action registry — single source of truth for what actions
 * exist and how they behave. Surfaces (context menu, card quick-actions,
 * selection bar, command palette builder) consume this registry.
 *
 * Adding a new action: add an entry here, declare its `surfaces`, write
 * its `run`, and ensure tests/actions/repoActions.test.js still passes.
 *
 * DOUBLE-REFRESH RULE: actions whose run() calls ctx.archiveRepos /
 * ctx.deleteRepos / ctx.performAction MUST NOT declare triggersRefresh:true
 * — those wrappers already refresh on success. Actions that bypass the
 * wrappers (e.g. ctx.api.syncMirror, modal opens) MAY declare it.
 *
 * @typedef {Object} RepoAction
 * @property {string} id                              snake_case, unique
 * @property {((repo) => string)|string} label
 * @property {((repo) => string|null)|string|null} [description]
 * @property {Function|((repo) => Function)} icon
 * @property {'navigation'|'copy'|'mutation'|'destructive'|'read-only'} intent
 * @property {Array<'contextMenu'|'quickAction'|'selectionBar'|'commandPalette'>} surfaces
 * @property {number} [quickActionPriority]
 * @property {boolean} [isBatchSafe]
 * @property {(repo) => boolean} [isApplicable]
 * @property {(target) => Object|null} [confirm]
 * @property {boolean} [triggersRefresh]
 * @property {(target, ctx) => Promise<void>} run
 * @property {{ key: string, description?: string }} [keyboardShortcut]
 *           Optional repo-scoped shortcut surfaced by the help modal.
 *           Execution requires a focused-repo target — see
 *           src/config/keyboardShortcuts.js for the wiring contract.
 */
export const repoActions = {
	// ───── Navigation ─────
	open_detail: {
		id: 'open_detail',
		label: 'Open details',
		description: 'Opens this repository in the in-app detail view.',
		icon: Eye,
		intent: 'navigation',
		surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
		quickActionPriority: 10,
		run: async (repo) => {
			emitAppEvent(APP_EVENTS.OPEN_REPO_DETAIL, { owner: repo.owner?.login, repo: repo.name, repoObject: repo })
		},
	},
	open_repo_settings: {
		id: 'open_repo_settings',
		label: 'Open settings',
		description: 'Opens the in-app Settings tab for this repository.',
		icon: Settings,
		intent: 'navigation',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo) => {
			emitAppEvent(APP_EVENTS.OPEN_REPO_SETTINGS, { owner: repo.owner?.login, repo: repo.name })
		},
	},
	open_on_github: {
		id: 'open_on_github',
		label: 'Open on GitHub',
		description: 'Opens this repository on github.com in a new tab.',
		icon: ExternalLink,
		intent: 'navigation',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo) => {
			window.open(repo.html_url, '_blank', 'noopener,noreferrer')
		},
	},
	migration_history: {
		id: 'migration_history',
		label: 'Migration history',
		description: 'Shows past migration attempts and their outcomes.',
		icon: History,
		intent: 'navigation',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (_repo, ctx) => ctx.openModal('showMigrationHistory'),
	},
	community_health: {
		id: 'community_health',
		label: 'Community health',
		description: 'Audits README, LICENSE, CONTRIBUTING, SECURITY, and templates.',
		icon: Shield,
		intent: 'navigation',
		surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
		quickActionPriority: 50,
		run: async (repo, ctx) => ctx.openModalWithData('showCommunityHealth', repo),
	},

	// ───── Copy ─────
	copy_clone_https: {
		id: 'copy_clone_https',
		label: 'Copy HTTPS URL',
		description: 'Copies the HTTPS clone URL to the clipboard.',
		icon: Globe,
		intent: 'copy',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => {
			await copyToClipboard(repo.clone_url)
			ctx.toast?.success?.('HTTPS URL copied')
		},
	},
	copy_clone_ssh: {
		id: 'copy_clone_ssh',
		label: 'Copy SSH URL',
		description: 'Copies the SSH clone URL to the clipboard.',
		icon: KeyRound,
		intent: 'copy',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => {
			await copyToClipboard(repo.ssh_url)
			ctx.toast?.success?.('SSH URL copied')
		},
	},
	copy_clone_gh: {
		id: 'copy_clone_gh',
		label: 'Copy `gh` CLI',
		description: 'Copies a `gh repo clone` command to the clipboard.',
		icon: Terminal,
		intent: 'copy',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => {
			await copyToClipboard(`gh repo clone ${repo.full_name}`)
			ctx.toast?.success?.('gh CLI command copied')
		},
	},

	// ───── Mutation: visibility ─────
	visibility: {
		id: 'visibility',
		label: (repo) => repo.private ? 'Make public' : 'Make private',
		description: (repo) => repo.private
			? 'Lets anyone on the internet view this repository and its contents.'
			: 'Removes the repository from public listings. Existing public links will return 404.',
		icon: (repo) => repo?.private ? Unlock : Lock,
		intent: 'mutation',
		surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
		quickActionPriority: 20,
		// NOTE: ctx.performAction wrapper already refreshes — no triggersRefresh.
		confirm: (repo) => ({
			title: `Make ${repo.name} ${repo.private ? 'public' : 'private'}?`,
			message: repo.private
				? `"${repo.name}" will become visible to everyone on the internet.`
				: `"${repo.name}" will be hidden from public listings; existing public links will 404.`,
			confirmText: repo.private ? 'Make Public' : 'Make Private',
			variant: 'warning',
		}),
		run: async (repo, ctx) => {
			await ctx.performAction('visibility', [repo.full_name], '', { makePublic: !!repo.private })
			ctx.toast.success(`${repo.name} is now ${repo.private ? 'public' : 'private'}`)
		},
	},

	// ───── Mutation: archive ─────
	/** @unconfirmed-by-design unarchive direction only — reactivating is the reversal, and toast feedback is enough; archiving itself confirms below since it makes the repo read-only until someone reverses it. */
	archive: {
		id: 'archive',
		label: (repo) => repo.archived ? 'Unarchive' : 'Archive',
		description: (repo) => repo.archived
			? 'Reactivates the repository — collaborators can push again.'
			: 'Marks the repo read-only on GitHub. No pushes, issues, or PRs until unarchived.',
		icon: Archive,
		intent: 'mutation',
		surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
		quickActionPriority: 30,
		// Archiving only — unarchiving is the reversal and needs no gate.
		confirm: (repo) => repo.archived ? null : ({
			title: `Archive ${repo.name}?`,
			message: 'Marks the repo read-only on GitHub — no pushes, issues, or PRs until you unarchive it. You can unarchive it any time.',
			confirmText: 'Archive',
			variant: 'warning',
		}),
		// NOTE: ctx.archiveRepos wrapper already refreshes — no triggersRefresh.
		run: async (repo, ctx) => {
			await ctx.archiveRepos([repo.full_name], !repo.archived)
			ctx.toast.success(`${repo.name} ${repo.archived ? 'unarchived' : 'archived'}`)
		},
	},

	// ───── Mutation: transfer ─────
	transfer: {
		id: 'transfer',
		label: 'Transfer to org',
		description: 'Hands ownership of this repo to another user or organization. The new owner must accept.',
		icon: ArrowRightLeft,
		intent: 'mutation',
		surfaces: ['contextMenu', 'commandPalette'],
		triggersRefresh: true,
		confirm: (repo) => ({
			title: `Transfer ${repo.name}?`,
			message: 'Transferring hands ownership to another account. The recipient must accept the transfer in their GitHub notifications. This is hard to reverse.',
			confirmText: 'Continue',
			variant: 'warning',
		}),
		// The transfer modal works over a list — hand it a one-element array,
		// never a bare repo (it calls `repos.map`).
		run: async (repo, ctx) => ctx.openModalWithData('showTransfer', [repo]),
	},

	// ───── Mutation: mirror ─────
	/** @unconfirmed-by-design opens the transfer modal in mirror mode, which runs its own confirmation flow */
	mirror: {
		id: 'mirror',
		label: 'Mirror / fork',
		description: 'Creates a mirror copy of this repository under your account.',
		icon: GitFork,
		intent: 'mutation',
		surfaces: ['contextMenu', 'commandPalette'],
		triggersRefresh: true,
		// There is no standalone mirror modal — mirroring is the transfer
		// modal's "Mirror" mode. Open it pre-switched to that mode.
		run: async (repo, ctx) => ctx.openModalWithData('showTransfer', { repos: [repo], action: 'mirror' }),
	},

	// ───── Mutation: sync ─────
	sync: {
		id: 'sync',
		label: 'Sync repository',
		description: 'Fetches latest changes from the mirror source and force-pushes to the target. Only available for mirrored repos.',
		icon: RefreshCw,
		intent: 'mutation',
		surfaces: ['contextMenu', 'commandPalette'],
		triggersRefresh: true,
		isApplicable: (repo) => !!repo?.isMirror,
		confirm: (repo) => ({
			title: 'Sync Mirror',
			message: `Fetch latest changes from ${repo.full_name}'s mirror source and force-push to the target?`,
			confirmText: 'Sync',
			variant: 'info',
		}),
		run: async (repo, ctx) => {
			const result = await ctx.api.syncMirror(repo.owner.login, repo.name)
			ctx.toast.success(`Synced in ${Math.round(result.duration / 1000)}s`)
		},
	},

	// Read-only sync preview (free on every tier) -- no clone/push.
	sync_preview: {
		id: 'sync_preview',
		label: 'Preview sync',
		description: 'Shows the mirror source, target, and last sync — read-only, no changes. Available on every plan.',
		icon: Eye,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		isApplicable: (repo) => !!repo?.isMirror,
		run: async (repo, ctx) => {
			const p = await ctx.api.previewSync(repo.owner.login, repo.name)
			const last = formatDateTime(p.lastSyncedAt) || 'never synced'
			// Sync apply is free on every tier (2026-07-18 rebalance), capped at
			// syncApplyPerMonth — show remaining runs instead of the old
			// (now-removed) applyRequiresPro gate.
			const remaining = typeof p.syncApplyRemaining === 'number' && Number.isFinite(p.syncApplyRemaining)
				? ` · ${p.syncApplyRemaining} sync applies left this month`
				: ''
			ctx.toast.success(`Mirror: ${p.sourceName || p.sourceUrl} → ${p.target} · last synced ${last}${remaining}`)
		},
	},

	// ───── Mutation: AI suggest name & description ─────
	/** @unconfirmed-by-design opens a dedicated modal where the user reviews + confirms each suggestion */
	ai_suggest_name_desc: {
		id: 'ai_suggest_name_desc',
		label: 'Suggest name & description',
		description: 'AI proposes a clearer name and description; you review before applying.',
		icon: Lightbulb,
		intent: 'mutation',
		surfaces: ['contextMenu', 'commandPalette'],
		triggersRefresh: true,
		run: async (repo, ctx) => ctx.openModalWithData('suggestNameDescription', { repo }),
	},

	// ───── Mutation: AI community-health auto-fix ─────
	/** @unconfirmed-by-design opens the Community Health modal where each missing file has its own preview/edit/commit confirmation flow */
	fix_community_health: {
		id: 'fix_community_health',
		label: 'Fix community health',
		description: 'AI generates missing community files (LICENSE, CONTRIBUTING, etc.) for one-click commit.',
		icon: Heart,
		intent: 'mutation',
		surfaces: ['contextMenu', 'commandPalette'],
		triggersRefresh: true,
		run: async (repo, ctx) => ctx.openModalWithData('showCommunityHealth', repo),
	},

	// ───── Migration & export ─────
	/** @unconfirmed-by-design opens the migration wizard which has its own multi-step confirmation flow */
	migrate: {
		id: 'migrate',
		label: 'Migrate to GitHub',
		description: 'Imports this repository (or a remote URL) into GitHub via the migration wizard.',
		icon: Upload,
		intent: 'mutation',
		surfaces: ['contextMenu', 'commandPalette'],
		triggersRefresh: true,
		run: async (_repo, ctx) => ctx.openModal('showMigrationWizard'),
	},
	dry_run: {
		id: 'dry_run',
		label: 'Dry-run (simulate)',
		description: 'Simulates the migration without writing anything; reports what would happen.',
		icon: FlaskConical,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (_repo, ctx) => ctx.openModalWithData('showMigrationWizard', { initialDryRun: true }),
	},
	export_meta: {
		id: 'export_meta',
		label: 'Export metadata (JSON)',
		description: 'Downloads a JSON file with this repository’s settings and metadata.',
		icon: Download,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => {
			const result = await ctx.api.exportMetadata(repo.owner.login, repo.name)
			ctx.toast.success(`Exported ${result.filename}`)
		},
	},

	// ───── Read-only: AI ─────
	ai_commit: {
		id: 'ai_commit',
		label: 'Generate commit message',
		description: 'AI drafts a commit message from your staged diff.',
		icon: Wand2,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => ctx.openModalWithData('showDevToolkit', { initialTab: 'commits', repo }),
	},
	ai_pr: {
		id: 'ai_pr',
		label: 'Generate PR description',
		description: 'AI writes a PR description from the branch diff and recent commits.',
		icon: GitPullRequest,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => ctx.openModalWithData('showDevToolkit', { initialTab: 'pr', repo }),
	},
	ai_quality: {
		id: 'ai_quality',
		label: 'Quality report',
		description: 'AI scores README, CI, tests, and other quality signals.',
		icon: BarChart3,
		intent: 'read-only',
		surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
		quickActionPriority: 40,
		run: async (repo, ctx) => ctx.openModalWithData('showRepoInsights', { repo, initialTab: 'quality' }),
	},
	ai_compare: {
		id: 'ai_compare',
		label: 'Compare with existing',
		description: 'AI flags repos in your account that overlap with this one.',
		icon: GitCompare,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => ctx.openModalWithData('showCompare', { repo }),
	},
	ai_security: {
		id: 'ai_security',
		label: 'Security posture',
		description: 'Scans the repo for committed secrets and risky patterns.',
		icon: ShieldAlert,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => ctx.openModalWithData('showSecurityScan', { repo }),
	},

	// ───── Destructive ─────
	delete: {
		id: 'delete',
		label: 'Delete repository',
		description: 'Permanently deletes this repository on GitHub. This cannot be undone.',
		icon: Trash2,
		intent: 'destructive',
		surfaces: ['contextMenu', 'commandPalette'],
		// NOTE: ctx.deleteRepos wrapper already refreshes — no triggersRefresh.
		confirm: (repo) => ({
			title: `Delete ${repo.name}?`,
			message: `This permanently deletes "${repo.full_name}". This cannot be undone. Type the repo name to confirm.`,
			confirmText: 'Delete',
			variant: 'danger',
			requiresInput: repo.name,
		}),
		run: async (repo, ctx) => {
			await ctx.deleteRepos([repo.full_name])
			ctx.toast.success(`${repo.name} deleted`)
		},
	},

	// ───── Batch ─────
	/** @unconfirmed-by-design highly reversible — count is shown in toast */
	archive_selected: {
		id: 'archive_selected',
		label: (repos) => `Archive ${repos.length} repos`,
		description: 'Archives all selected repositories. Reversible.',
		icon: Archive,
		intent: 'mutation',
		surfaces: ['selectionBar', 'commandPalette'],
		isBatchSafe: true,
		// NOTE: ctx.archiveRepos wrapper already refreshes.
		run: async (repos, ctx) => {
			await ctx.archiveRepos(repos.map((r) => r.full_name), true)
			ctx.toast.success(`Archived ${repos.length} repositories`)
		},
	},
	transfer_selected: {
		id: 'transfer_selected',
		label: (repos) => `Transfer ${repos.length} repos`,
		description: 'Hands ownership of selected repos to another account.',
		icon: ArrowRightLeft,
		intent: 'mutation',
		surfaces: ['selectionBar', 'commandPalette'],
		isBatchSafe: true,
		triggersRefresh: true,
		confirm: (repos) => ({
			title: `Transfer ${repos.length} repositories?`,
			message: `The following repositories will be transferred (each recipient must accept):\n\n${repos.slice(0, 5).map((r) => `• ${r.full_name}`).join('\n')}${repos.length > 5 ? `\n• …and ${repos.length - 5} more` : ''}`,
			confirmText: 'Continue',
			variant: 'warning',
		}),
		// Forward the selection — opening with no data would render an empty
		// modal ("0 repos will be transferred").
		run: async (repos, ctx) => ctx.openModalWithData('showTransfer', repos),
	},
	/** @unconfirmed-by-design opens the migration wizard which has its own multi-step confirmation flow */
	migrate_selected: {
		id: 'migrate_selected',
		label: (repos) => `Migrate ${repos.length} repos`,
		description: 'Imports the selected repositories via the migration wizard.',
		icon: Upload,
		intent: 'mutation',
		surfaces: ['selectionBar', 'commandPalette'],
		isBatchSafe: true,
		triggersRefresh: true,
		run: async (_repos, ctx) => ctx.openModal('showMigrationWizard'),
	},
	dry_run_selected: {
		id: 'dry_run_selected',
		label: (repos) => `Dry-run ${repos.length} repos`,
		description: 'Simulates migrating the selected repositories.',
		icon: FlaskConical,
		intent: 'read-only',
		surfaces: ['selectionBar', 'commandPalette'],
		isBatchSafe: true,
		run: async (_repos, ctx) => ctx.openModalWithData('showMigrationWizard', { initialDryRun: true }),
	},
	export_meta_selected: {
		id: 'export_meta_selected',
		label: (repos) => `Export ${repos.length} (JSON)`,
		description: 'Exports metadata for each selected repository.',
		icon: Download,
		intent: 'read-only',
		surfaces: ['selectionBar', 'commandPalette'],
		isBatchSafe: true,
		run: async (repos, ctx) => {
			let ok = 0
			try {
				for (const repo of repos) {
					await ctx.api.exportMetadata(repo.owner.login, repo.name)
					ok++
				}
				ctx.toast.success(`Exported ${ok} repositories`)
			} catch (err) {
				ctx.toast.errorFromException(err, { fallbackTitle: `Exported ${ok} of ${repos.length}; stopped` })
			}
		},
	},
	ai_batch_index_selected: {
		id: 'ai_batch_index_selected',
		label: (repos) => `Batch index ${repos.length} with AI`,
		description: 'Indexes the selected repositories so AI search can find them.',
		icon: Sparkles,
		intent: 'read-only',
		surfaces: ['selectionBar', 'commandPalette'],
		isBatchSafe: true,
		run: async (repos, ctx) => ctx.openModalWithData('showBatchIndex', { repos }),
	},
	// Two explicit batch visibility actions. The old single `visibility_selected`
	// action was mislabelled "Make Public/Private" but hard-coded private, so a
	// user intending public silently got the opposite. Splitting into two
	// self-describing actions removes the ambiguity (no target picker needed) and
	// makes the confirm/toast copy match what actually happens.
	make_public_selected: {
		id: 'make_public_selected',
		label: (repos) => `Make ${repos.length} repos public`,
		description: 'Makes all selected repositories visible to everyone on the internet.',
		icon: Unlock,
		intent: 'mutation',
		surfaces: ['selectionBar', 'commandPalette'],
		isBatchSafe: true,
		// NOTE: ctx.performAction wrapper already refreshes.
		confirm: (repos) => ({
			title: `Make ${repos.length} repositories public?`,
			message: `The following repositories will become visible to everyone on the internet:\n\n${repos.slice(0, 5).map((r) => `• ${r.full_name}`).join('\n')}${repos.length > 5 ? `\n• …and ${repos.length - 5} more` : ''}`,
			confirmText: 'Make Public',
			variant: 'warning',
		}),
		run: async (repos, ctx) => {
			await ctx.performAction('visibility', repos.map((r) => r.full_name), '', { makePublic: true })
			ctx.toast.success(`${repos.length} repositories are now public`)
		},
	},
	make_private_selected: {
		id: 'make_private_selected',
		label: (repos) => `Make ${repos.length} repos private`,
		description: 'Hides all selected repositories from public listings. Existing public links will 404.',
		icon: Lock,
		intent: 'mutation',
		surfaces: ['selectionBar', 'commandPalette'],
		isBatchSafe: true,
		// NOTE: ctx.performAction wrapper already refreshes.
		confirm: (repos) => ({
			title: `Make ${repos.length} repositories private?`,
			message: `The following repositories will be hidden from public listings; already-cached public links will 404:\n\n${repos.slice(0, 5).map((r) => `• ${r.full_name}`).join('\n')}${repos.length > 5 ? `\n• …and ${repos.length - 5} more` : ''}`,
			confirmText: 'Make Private',
			variant: 'warning',
		}),
		run: async (repos, ctx) => {
			await ctx.performAction('visibility', repos.map((r) => r.full_name), '', { makePublic: false })
			ctx.toast.success(`${repos.length} repositories are now private`)
		},
	},
	delete_selected: {
		id: 'delete_selected',
		label: (repos) => `Delete ${repos.length} repos`,
		description: 'Permanently deletes the selected repositories. This cannot be undone.',
		icon: Trash2,
		intent: 'destructive',
		surfaces: ['selectionBar', 'commandPalette'],
		isBatchSafe: true,
		// NOTE: ctx.deleteRepos wrapper already refreshes.
		confirm: (repos) => ({
			title: `Delete ${repos.length} repositories?`,
			message: `This permanently deletes the following:\n\n${repos.slice(0, 5).map((r) => `• ${r.full_name}`).join('\n')}${repos.length > 5 ? `\n• …and ${repos.length - 5} more` : ''}\n\nType "delete ${repos.length} repos" to confirm.`,
			confirmText: 'Delete All',
			variant: 'danger',
			requiresInput: `delete ${repos.length} repos`,
		}),
		run: async (repos, ctx) => {
			await ctx.deleteRepos(repos.map((r) => r.full_name))
			ctx.toast.success(`Deleted ${repos.length} repositories`)
		},
	},
}

/**
 * buildRepoActionCommands — emits `{ id, label, description, run }[]` from
 * the registry for the command palette to render. The palette is responsible
 * for grouping/filtering by recents/typing; the builder just enumerates.
 *
 * Skips batch actions (`isBatchSafe`) — they require a selection, which is a
 * separate context the palette doesn't own. Phase 2 may revisit when the
 * palette gains selection-awareness.
 */
export function buildRepoActionCommands(repos, ctx) {
	return buildActionCommands(repoActions, repos, ctx, {
		keyOf: (repo) => repo.id,
		labelOf: (repo) => repo.full_name,
		skipBatchSafe: true,
	})
}
