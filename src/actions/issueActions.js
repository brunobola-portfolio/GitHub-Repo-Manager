/*
 * GitHub Repo Manager
 * Issue action registry — single source of truth for what actions exist
 * on an issue and how they behave. Mirrors src/actions/repoActions.js.
 *
 * Adding a new issue action: add an entry here, declare its `surfaces`,
 * write its `run`, and ensure tests/actions/issueActions.test.js still
 * passes.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import {
    Eye, ExternalLink, Copy, CheckCircle2, RotateCcw, Sparkles, MessageSquare,
} from 'lucide-react'
import { copyToClipboard } from '../utils/clipboard'
import { buildActionCommands } from './buildActionCommands'

/**
 * @typedef {Object} IssueTarget
 * @property {number} number
 * @property {string} title
 * @property {string} html_url
 * @property {string} state                  'open' | 'closed'
 * @property {{ login: string }} [user]
 *
 * @typedef {Object} IssueAction
 * @property {string} id
 * @property {((issue) => string)|string} label
 * @property {((issue) => string|null)|string|null} [description]
 * @property {Function|((issue) => Function)} icon
 * @property {'navigation'|'copy'|'mutation'|'destructive'|'read-only'} intent
 * @property {Array<'inlineButton'|'commandPalette'|'contextMenu'>} surfaces
 * @property {(issue) => boolean} [isApplicable]
 * @property {(issue) => Object|null} [confirm]
 * @property {(issue, ctx) => Promise<void>} run
 */

export const issueActions = {
    // ───── Navigation ─────
    view_issue: {
        id: 'view_issue',
        label: 'Open Issue',
        description: 'Opens this issue in the in-app detail panel.',
        icon: Eye,
        intent: 'navigation',
        surfaces: ['inlineButton', 'commandPalette'],
        run: async (issue, ctx) => {
            ctx?.onSelectIssue?.(issue)
        },
    },
    open_issue_on_github: {
        id: 'open_issue_on_github',
        label: 'Open on GitHub',
        description: 'Opens this issue on github.com in a new tab.',
        icon: ExternalLink,
        intent: 'navigation',
        surfaces: ['contextMenu', 'commandPalette'],
        isApplicable: (issue) => Boolean(issue?.html_url),
        run: async (issue) => {
            window.open(issue.html_url, '_blank', 'noopener,noreferrer')
        },
    },

    // ───── Copy ─────
    copy_issue_url: {
        id: 'copy_issue_url',
        label: 'Copy issue URL',
        description: 'Copies the github.com issue URL to the clipboard.',
        icon: Copy,
        intent: 'copy',
        surfaces: ['contextMenu', 'commandPalette'],
        isApplicable: (issue) => Boolean(issue?.html_url),
        run: async (issue, ctx) => {
            await copyToClipboard(issue.html_url)
            ctx?.toast?.success?.('Issue URL copied')
        },
    },
    copy_issue_ref: {
        id: 'copy_issue_ref',
        label: 'Copy issue reference',
        description: 'Copies a `#NN` reference for use in commit messages or PR bodies.',
        icon: Copy,
        intent: 'copy',
        surfaces: ['contextMenu', 'commandPalette'],
        run: async (issue, ctx) => {
            await copyToClipboard(`#${issue.number}`)
            ctx?.toast?.success?.(`Copied #${issue.number}`)
        },
    },

    // ───── Read-only / AI ─────
    plan_issue: {
        id: 'plan_issue',
        label: 'Plan with AI',
        description: 'AI proposes a structured implementation plan (files, approach, tests, risks) for this issue.',
        icon: Sparkles,
        intent: 'read-only',
        surfaces: ['inlineButton', 'commandPalette'],
        isApplicable: (issue) => issue?.state === 'open',
        run: async (issue, ctx) => {
            ctx?.onPlanWithAI?.(issue)
        },
    },
    comment_on_issue: {
        id: 'comment_on_issue',
        label: 'Add comment',
        description: 'Opens the issue detail panel scrolled to the comment composer.',
        icon: MessageSquare,
        intent: 'navigation',
        surfaces: ['contextMenu', 'commandPalette'],
        run: async (issue, ctx) => {
            ctx?.onSelectIssue?.(issue, { focusComment: true })
        },
    },

    // ───── Mutation ─────
    close_issue: {
        id: 'close_issue',
        label: 'Close',
        description: 'Closes the issue. Can be reopened later.',
        icon: CheckCircle2,
        intent: 'mutation',
        surfaces: ['inlineButton', 'commandPalette'],
        isApplicable: (issue) => issue?.state === 'open',
        confirm: (issue) => ({
            title: `Close issue #${issue.number}?`,
            message: `"${issue.title}" will be marked as closed. You can reopen it later.`,
            confirmText: 'Close',
            variant: 'warning',
        }),
        run: async (issue, ctx) => {
            await ctx.api.updateIssue(issue.number, { state: 'closed' })
            ctx.toast?.success?.(`Closed issue #${issue.number}`)
            ctx?.refresh?.()
        },
    },
    reopen_issue: {
        id: 'reopen_issue',
        label: 'Reopen',
        description: 'Reopens this closed issue.',
        icon: RotateCcw,
        intent: 'mutation',
        surfaces: ['inlineButton', 'commandPalette'],
        isApplicable: (issue) => issue?.state === 'closed',
        run: async (issue, ctx) => {
            await ctx.api.updateIssue(issue.number, { state: 'open' })
            ctx.toast?.success?.(`Reopened issue #${issue.number}`)
            ctx?.refresh?.()
        },
    },
}

/**
 * @param {IssueTarget[]} issues
 * @param {Object} ctx
 */
export function buildIssueActionCommands(issues, ctx) {
    return buildActionCommands(issueActions, issues, ctx, {
        keyOf: (issue) => issue.number,
        labelOf: (issue) => `#${issue.number} ${issue.title}`,
    })
}
