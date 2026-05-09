/**
 * PR-review-scoped command builder. Returns cmdk command items relevant
 * only when a PR review surface (PRReviewView) is mounted and focused.
 *
 * Each command dispatches a global CustomEvent that PRReviewView listens
 * for. Loose coupling via events keeps the palette ignorant of the
 * surface's internal handlers — and makes adding new commands trivial.
 *
 * @typedef {object} PRReviewCommand
 * @property {string} id
 * @property {string} label
 * @property {string} searchValue
 * @property {string} icon         — lucide icon name
 * @property {'event'} kind
 * @property {string} event        — window event to dispatch
 */

/** @returns {PRReviewCommand[]} */
export function buildPRReviewCommands() {
    return [
        {
            id: 'pr-review-mark-viewed',
            label: 'Mark current file as reviewed',
            searchValue: 'mark file viewed reviewed pr',
            icon: 'Check',
            kind: 'event',
            event: 'pr-review:toggle-reviewed',
        },
        {
            id: 'pr-review-approve',
            label: 'Approve pull request',
            searchValue: 'approve pull request review',
            icon: 'ShieldCheck',
            kind: 'event',
            event: 'pr-review:approve',
        },
        {
            id: 'pr-review-request-changes',
            label: 'Request changes on pull request',
            searchValue: 'request changes pr review',
            icon: 'ShieldAlert',
            kind: 'event',
            event: 'pr-review:request-changes',
        },
        {
            id: 'pr-review-comment',
            label: 'Comment on pull request review',
            searchValue: 'comment pr review',
            icon: 'MessageCircle',
            kind: 'event',
            event: 'pr-review:comment',
        },
        {
            id: 'pr-review-toggle-tree',
            label: 'Toggle file tree',
            searchValue: 'toggle file tree show hide pr',
            icon: 'GitBranch',
            kind: 'event',
            event: 'pr-review:toggle-tree',
        },
        {
            id: 'pr-review-show-help',
            label: 'Show keyboard shortcuts',
            searchValue: 'help shortcuts keyboard pr review',
            icon: 'FileText',
            kind: 'event',
            event: 'pr-review:show-help',
        },
    ]
}
