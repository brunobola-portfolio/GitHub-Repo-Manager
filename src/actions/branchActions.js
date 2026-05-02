/*
 * GitHub Repo Manager
 * Branch action registry — single source of truth for what actions exist
 * on a branch and how they behave. Mirrors src/actions/repoActions.js.
 *
 * Adding a new branch action: add an entry here, declare its `surfaces`,
 * write its `run`, and ensure tests/actions/branchActions.test.js still
 * passes.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import { Eye, Copy, Trash2, ShieldCheck } from 'lucide-react'
import { copyToClipboard } from '../utils/clipboard'

/**
 * @typedef {Object} BranchTarget
 * @property {string} name
 * @property {boolean} [protected]
 * @property {{ sha: string }} [commit]
 *
 * @typedef {Object} BranchAction
 * @property {string} id
 * @property {((branch) => string)|string} label
 * @property {((branch) => string|null)|string|null} [description]
 * @property {Function|((branch) => Function)} icon
 * @property {'navigation'|'copy'|'mutation'|'destructive'|'read-only'} intent
 * @property {Array<'inlineButton'|'commandPalette'|'contextMenu'>} surfaces
 * @property {(branch) => boolean} [isApplicable]
 * @property {(branch) => Object|null} [confirm]
 * @property {(branch, ctx) => Promise<void>} run
 */

export const branchActions = {
    // ───── Navigation / copy ─────
    open_branch_on_github: {
        id: 'open_branch_on_github',
        label: 'Open on GitHub',
        description: 'Opens this branch on github.com in a new tab.',
        icon: Eye,
        intent: 'navigation',
        surfaces: ['contextMenu', 'commandPalette'],
        isApplicable: (b, ctx) => Boolean(b?.name && ctx?.repoFullName),
        run: async (branch, ctx) => {
            const url = `https://github.com/${ctx.repoFullName}/tree/${encodeURIComponent(branch.name)}`
            window.open(url, '_blank', 'noopener,noreferrer')
        },
    },
    copy_branch_name: {
        id: 'copy_branch_name',
        label: 'Copy branch name',
        description: 'Copies the branch name to the clipboard.',
        icon: Copy,
        intent: 'copy',
        surfaces: ['contextMenu', 'commandPalette'],
        run: async (branch, ctx) => {
            await copyToClipboard(branch.name)
            ctx?.toast?.success?.('Branch name copied')
        },
    },
    copy_branch_checkout_cmd: {
        id: 'copy_branch_checkout_cmd',
        label: 'Copy `git checkout` command',
        description: 'Copies a ready-to-paste `git checkout` command.',
        icon: Copy,
        intent: 'copy',
        surfaces: ['contextMenu', 'commandPalette'],
        run: async (branch, ctx) => {
            await copyToClipboard(`git checkout ${branch.name}`)
            ctx?.toast?.success?.('git checkout command copied')
        },
    },

    // ───── Mutation ─────
    /** @unconfirmed-by-design opens a dedicated panel that runs its own confirmation flow */
    protect_branch: {
        id: 'protect_branch',
        label: (b) => b?.protected ? 'Edit Branch Protection' : 'Add Branch Protection',
        description: 'Configures push/review/status-check requirements on this branch.',
        icon: ShieldCheck,
        intent: 'mutation',
        surfaces: ['contextMenu', 'commandPalette'],
        run: async (branch, ctx) => {
            ctx?.openModalWithData?.('showBranchProtection', { branch: branch.name })
        },
    },

    // ───── Destructive ─────
    delete_branch: {
        id: 'delete_branch',
        label: 'Delete branch',
        description: 'Permanently deletes this branch on GitHub. This cannot be undone.',
        icon: Trash2,
        intent: 'destructive',
        surfaces: ['inlineButton', 'contextMenu', 'commandPalette'],
        // Don't allow deleting protected branches via this path; the GitHub
        // API would refuse but pre-gating gives a cleaner UX.
        isApplicable: (b) => !b?.protected,
        confirm: (branch) => ({
            title: `Delete branch "${branch.name}"?`,
            message: `This permanently deletes the branch on GitHub. This cannot be undone. Type the branch name to confirm.`,
            confirmText: 'Delete',
            variant: 'danger',
            requiresInput: branch.name,
        }),
        run: async (branch, ctx) => {
            await ctx.api.deleteBranch(branch.name)
            ctx.toast?.success?.(`Deleted branch "${branch.name}"`)
            ctx?.refresh?.()
        },
    },
}

/**
 * @param {BranchTarget[]} branches
 * @param {Object} ctx — must include repoFullName for url-shaped actions
 */
export function buildBranchActionCommands(branches, ctx) {
    const out = []
    for (const action of Object.values(branchActions)) {
        if (!action.surfaces.includes('commandPalette')) continue
        for (const branch of branches) {
            if (action.isApplicable && !action.isApplicable(branch, ctx)) continue
            const resolveDyn = (val) => (typeof val === 'function' ? val(branch) : val)
            out.push({
                id: `${action.id}::${branch.name}`,
                label: `${resolveDyn(action.label)} — ${branch.name}`,
                description: resolveDyn(action.description),
                run: () => action.run(branch, ctx),
            })
        }
    }
    return out
}
