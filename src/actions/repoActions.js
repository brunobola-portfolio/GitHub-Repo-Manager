import {
	Eye, Settings, ExternalLink, Globe, KeyRound, Terminal, History, Shield,
	Lock, Unlock, Archive, ArrowRightLeft, GitFork, RefreshCw, Lightbulb,
	Trash2, Wand2, GitPullRequest, BarChart3, GitCompare, ShieldAlert,
	Upload, FlaskConical, Download, Sparkles,
} from 'lucide-react'

const copyToClipboard = (text) => {
	if (typeof navigator !== 'undefined' && navigator.clipboard) {
		return navigator.clipboard.writeText(text)
	}
}

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
 */
export const repoActions = {
	// ───── Navigation ─────
	open_detail: {
		id: 'open_detail',
		label: 'Open Details',
		description: 'Opens this repository in the in-app detail view.',
		icon: Eye,
		intent: 'navigation',
		surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
		quickActionPriority: 10,
		run: async (repo) => {
			window.dispatchEvent(new CustomEvent('app:open-repo-detail', {
				detail: { owner: repo.owner?.login, repo: repo.name, repoObject: repo },
			}))
		},
	},
	open_repo_settings: {
		id: 'open_repo_settings',
		label: 'Open Settings',
		description: 'Opens the in-app Settings tab for this repository.',
		icon: Settings,
		intent: 'navigation',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo) => {
			window.dispatchEvent(new CustomEvent('app:open-repo-settings', {
				detail: { owner: repo.owner?.login, repo: repo.name },
			}))
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
		label: 'Migration History',
		description: 'Shows past migration attempts and their outcomes.',
		icon: History,
		intent: 'navigation',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (_repo, ctx) => ctx.openModal('showMigrationHistory'),
	},
	community_health: {
		id: 'community_health',
		label: 'Community Health',
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
		label: (repo) => repo.private ? 'Make Public' : 'Make Private',
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
	/** @unconfirmed-by-design highly reversible — toast feedback is enough; modal would feel pedantic */
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
		// NOTE: ctx.archiveRepos wrapper already refreshes — no triggersRefresh.
		run: async (repo, ctx) => {
			await ctx.archiveRepos([repo.full_name], !repo.archived)
			ctx.toast.success(`${repo.name} ${repo.archived ? 'unarchived' : 'archived'}`)
		},
	},

	// ───── Mutation: transfer ─────
	transfer: {
		id: 'transfer',
		label: 'Transfer to Org',
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
		run: async (repo, ctx) => ctx.openModalWithData('showTransfer', repo),
	},

	// ───── Mutation: mirror ─────
	mirror: {
		id: 'mirror',
		label: 'Mirror / Fork',
		description: 'Creates a mirror copy of this repository under your account.',
		icon: GitFork,
		intent: 'mutation',
		surfaces: ['contextMenu', 'commandPalette'],
		triggersRefresh: true,
		run: async (repo, ctx) => ctx.openModalWithData('showMirror', repo),
	},

	// ───── Mutation: sync ─────
	sync: {
		id: 'sync',
		label: 'Sync Repository',
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

	// ───── Mutation: AI suggest name & description ─────
	ai_suggest_name_desc: {
		id: 'ai_suggest_name_desc',
		label: 'Suggest Name & Description',
		description: 'AI proposes a clearer name and description; you review before applying.',
		icon: Lightbulb,
		intent: 'mutation',
		surfaces: ['contextMenu', 'commandPalette'],
		triggersRefresh: true,
		run: async (repo, ctx) => ctx.openModalWithData('suggestNameDescription', { repo }),
	},

	// ───── Read-only: AI ─────
	ai_commit: {
		id: 'ai_commit',
		label: 'Generate Commit Message',
		description: 'AI drafts a commit message from your staged diff.',
		icon: Wand2,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => ctx.openModalWithData('showDevToolkit', { initialTab: 'commits', repo }),
	},
	ai_pr: {
		id: 'ai_pr',
		label: 'Generate PR Description',
		description: 'AI writes a PR description from the branch diff and recent commits.',
		icon: GitPullRequest,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => ctx.openModalWithData('showDevToolkit', { initialTab: 'pr', repo }),
	},
	ai_quality: {
		id: 'ai_quality',
		label: 'Quality Report',
		description: 'AI scores README, CI, tests, and other quality signals.',
		icon: BarChart3,
		intent: 'read-only',
		surfaces: ['contextMenu', 'quickAction', 'commandPalette'],
		quickActionPriority: 40,
		run: async (repo, ctx) => ctx.openModalWithData('showRepoInsights', { repo, initialTab: 'quality' }),
	},
	ai_compare: {
		id: 'ai_compare',
		label: 'Compare with Existing',
		description: 'AI flags repos in your account that overlap with this one.',
		icon: GitCompare,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => ctx.openModalWithData('showCompare', { repo }),
	},
	ai_security: {
		id: 'ai_security',
		label: 'Security / Secrets Scan',
		description: 'Scans the repo for committed secrets and risky patterns.',
		icon: ShieldAlert,
		intent: 'read-only',
		surfaces: ['contextMenu', 'commandPalette'],
		run: async (repo, ctx) => ctx.openModalWithData('showSecurityScan', { repo }),
	},

	// ───── Destructive ─────
	delete: {
		id: 'delete',
		label: 'Delete Repository',
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
}
