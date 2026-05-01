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
}
