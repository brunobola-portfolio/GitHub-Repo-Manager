/*
 * GitHub Repo Manager
 * Pull Request action registry — single source of truth for what actions
 * exist on a PR and how they behave.
 *
 * Mirrors src/actions/repoActions.js. Surfaces (PullRequestsTab inline
 * buttons, future PR context menu, command palette) consume this registry
 * via buildPRActionCommands. Action runners receive a `ctx` packaging the
 * dependencies they need (api/toast/modal/refresh/confirmGate).
 *
 * Adding a new PR action: add an entry here, declare its `surfaces`, write
 * its `run`, and ensure tests/actions/prActions.test.js still passes.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import {
    Eye, ExternalLink, Copy, GitMerge, X, Wand2, MessageCircle,
} from 'lucide-react'

const copyToClipboard = (text) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
        return navigator.clipboard.writeText(text)
    }
}

/**
 * @typedef {Object} PRTarget
 * @property {number} number
 * @property {string} title
 * @property {string} html_url
 * @property {string} state              'open' | 'closed'
 * @property {boolean} [merged]
 * @property {string} [merged_at]
 * @property {{ login: string }} [user]
 *
 * @typedef {Object} PRAction
 * @property {string} id                                snake_case, unique
 * @property {((pr) => string)|string} label
 * @property {((pr) => string|null)|string|null} [description]
 * @property {Function|((pr) => Function)} icon
 * @property {'navigation'|'copy'|'mutation'|'destructive'|'read-only'} intent
 * @property {Array<'inlineButton'|'commandPalette'|'contextMenu'>} surfaces
 * @property {(pr) => boolean} [isApplicable]
 * @property {(pr) => Object|null} [confirm]
 * @property {(pr, ctx) => Promise<void>} run
 */

export const prActions = {
    // ───── Navigation ─────
    view_pr: {
        id: 'view_pr',
        label: 'Open PR',
        description: 'Opens this pull request in the in-app detail panel.',
        icon: Eye,
        intent: 'navigation',
        surfaces: ['inlineButton', 'commandPalette'],
        run: async (pr, ctx) => {
            ctx?.onSelectPR?.(pr)
        },
    },
    open_pr_on_github: {
        id: 'open_pr_on_github',
        label: 'Open on GitHub',
        description: 'Opens this PR on github.com in a new tab.',
        icon: ExternalLink,
        intent: 'navigation',
        surfaces: ['contextMenu', 'commandPalette'],
        isApplicable: (pr) => Boolean(pr?.html_url),
        run: async (pr) => {
            window.open(pr.html_url, '_blank', 'noopener,noreferrer')
        },
    },

    // ───── Copy ─────
    copy_pr_url: {
        id: 'copy_pr_url',
        label: 'Copy PR URL',
        description: 'Copies the github.com PR URL to the clipboard.',
        icon: Copy,
        intent: 'copy',
        surfaces: ['contextMenu', 'commandPalette'],
        isApplicable: (pr) => Boolean(pr?.html_url),
        run: async (pr, ctx) => {
            await copyToClipboard(pr.html_url)
            ctx?.toast?.success?.('PR URL copied')
        },
    },
    copy_pr_branch: {
        id: 'copy_pr_branch',
        label: 'Copy branch name',
        description: 'Copies the PR head branch name (useful for `gh pr checkout`).',
        icon: Copy,
        intent: 'copy',
        surfaces: ['contextMenu', 'commandPalette'],
        isApplicable: (pr) => Boolean(pr?.head?.ref),
        run: async (pr, ctx) => {
            await copyToClipboard(pr.head.ref)
            ctx?.toast?.success?.('Branch name copied')
        },
    },

    // ───── Read-only / AI ─────
    start_review: {
        id: 'start_review',
        label: 'Start Review',
        description: 'Opens the inline-comment review flow for this PR.',
        icon: MessageCircle,
        intent: 'read-only',
        surfaces: ['inlineButton', 'commandPalette'],
        isApplicable: (pr) => pr?.state === 'open' && !pr?.merged_at && !pr?.merged,
        run: async (pr, ctx) => {
            ctx?.onStartReview?.(pr)
        },
    },
    generate_description: {
        id: 'generate_description',
        label: 'Generate Description',
        description: 'AI drafts a PR description from the branch diff and recent commits.',
        icon: Wand2,
        intent: 'read-only',
        surfaces: ['contextMenu', 'commandPalette'],
        isApplicable: (pr) => pr?.state === 'open',
        run: async (pr, ctx) => {
            ctx?.onGenerateDescription?.(pr)
        },
    },

    // ───── Mutation ─────
    merge_pr: {
        id: 'merge_pr',
        label: 'Merge',
        description: 'Merges this pull request into its base branch.',
        icon: GitMerge,
        intent: 'mutation',
        surfaces: ['inlineButton', 'commandPalette'],
        isApplicable: (pr) => pr?.state === 'open' && !pr?.merged_at && !pr?.merged,
        confirm: (pr) => ({
            title: 'Merge Pull Request',
            message: `Merge PR #${pr.number} "${pr.title}"?`,
            confirmText: 'Merge',
            variant: 'warning',
        }),
        run: async (pr, ctx) => {
            await ctx.api.mergePull(pr.number)
            ctx.toast?.success?.(`Merged PR #${pr.number}`)
            ctx?.refresh?.()
        },
    },

    // ───── Destructive (close is reversible — kept as 'mutation' not 'destructive') ─────
    close_pr: {
        id: 'close_pr',
        label: 'Close',
        description: 'Closes the pull request without merging. Can be reopened.',
        icon: X,
        intent: 'mutation',
        surfaces: ['inlineButton', 'commandPalette'],
        isApplicable: (pr) => pr?.state === 'open',
        confirm: (pr) => ({
            title: `Close PR #${pr.number}?`,
            message: `"${pr.title}" will be closed without merging. You can reopen it later.`,
            confirmText: 'Close PR',
            variant: 'warning',
        }),
        run: async (pr, ctx) => {
            await ctx.api.updatePull(pr.number, { state: 'closed' })
            ctx.toast?.success?.(`Closed PR #${pr.number}`)
            ctx?.refresh?.()
        },
    },
}

/**
 * buildPRActionCommands — emits palette-shaped items from the registry for
 * a list of PRs. Mirrors buildRepoActionCommands. Skips entries whose
 * isApplicable returns false for the given PR.
 *
 * @param {PRTarget[]} prs
 * @param {Object} ctx
 * @returns {Array<{id, label, description, run}>}
 */
export function buildPRActionCommands(prs, ctx) {
    const out = []
    for (const action of Object.values(prActions)) {
        if (!action.surfaces.includes('commandPalette')) continue
        for (const pr of prs) {
            if (action.isApplicable && !action.isApplicable(pr)) continue
            const resolveDyn = (val) => (typeof val === 'function' ? val(pr) : val)
            out.push({
                id: `${action.id}::${pr.number}`,
                label: `${resolveDyn(action.label)} — #${pr.number} ${pr.title}`,
                description: resolveDyn(action.description),
                run: () => action.run(pr, ctx),
            })
        }
    }
    return out
}
