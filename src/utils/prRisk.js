/**
 * Heuristic PR risk badges — computed from the fields the GitHub list API
 * already returns (no extra round-trips). The intent is reviewer triage:
 * surface "this PR needs attention" cues inline in the PR list so reviewers
 * don't have to open every PR to find the risky ones.
 *
 * Each detector is intentionally conservative — false positives are worse
 * than missed signals here because the badges live next to the title and
 * compete for visual attention.
 *
 * Why it lives in src/utils/ and not in the component: the same heuristics
 * will feed the future Attention Feed on the dashboard and the PR-detail
 * panel summary, so we want one place to evolve them.
 */

import { MS_PER_DAY } from './time'

const STALE_DAYS = 7
const VERY_STALE_DAYS = 21
const SHORT_BODY_THRESHOLD = 40
const MAX_REQUESTED_REVIEWERS = 3
const BREAKING_KEYWORDS = /\b(breaking|breaks?\s+(api|the)|backward(s?)[ -]?incompat|deprecat\w*\s+(removal|removed)|drop\s+support|migration\s+required)\b|\bBREAKING\s*CHANGE\b/i

const TONE = {
    danger: 'danger',
    warning: 'warning',
    info: 'info',
    neutral: 'neutral',
}

function daysBetween(later, earlier) {
    return Math.floor((later - earlier) / MS_PER_DAY)
}

/**
 * @param {object} pr  — GitHub PR list-shape (includes title, body, state,
 *                       draft, created_at, requested_reviewers, assignees,
 *                       labels, head, base)
 * @param {Date}   [now=new Date()]  — exposed for testability
 * @returns {Array<{ id: string, label: string, tone: string, hint: string }>}
 */
export function computePRRisks(pr, now = new Date()) {
    if (!pr || pr.state !== 'open') return []
    const risks = []

    const created = pr.created_at ? new Date(pr.created_at) : null
    const ageDays = created ? daysBetween(now.getTime(), created.getTime()) : 0

    // Stale — open more than 7 days. "Very stale" past 21 days bumps to danger.
    if (ageDays >= VERY_STALE_DAYS) {
        risks.push({
            id: 'very-stale',
            label: `${ageDays}d stale`,
            tone: TONE.danger,
            hint: `Open for ${ageDays} days — likely needs reviewer escalation or a close.`,
        })
    } else if (ageDays >= STALE_DAYS) {
        risks.push({
            id: 'stale',
            label: `${ageDays}d stale`,
            tone: TONE.warning,
            hint: `Open for ${ageDays} days — review queue is slipping.`,
        })
    }

    // Empty / very short description.
    if (!pr.draft) {
        const body = (pr.body ?? '').trim()
        if (body.length === 0) {
            risks.push({
                id: 'no-description',
                label: 'No description',
                tone: TONE.warning,
                hint: 'PR has no description — reviewers are flying blind.',
            })
        } else if (body.length < SHORT_BODY_THRESHOLD) {
            risks.push({
                id: 'short-description',
                label: 'Thin description',
                tone: TONE.info,
                hint: `Description is only ${body.length} characters — usually too sparse to review well.`,
            })
        }
    }

    // Breaking-change keywords in title or body.
    const haystack = `${pr.title ?? ''}\n${pr.body ?? ''}`
    if (BREAKING_KEYWORDS.test(haystack)) {
        risks.push({
            id: 'breaking',
            label: 'Breaking',
            tone: TONE.danger,
            hint: 'Title or body mentions a breaking change — verify migration notes are present.',
        })
    }

    // Reviewer state — only flag for non-draft open PRs older than 1 day.
    if (!pr.draft && ageDays >= 1) {
        const requested = Array.isArray(pr.requested_reviewers) ? pr.requested_reviewers.length : 0
        const requestedTeams = Array.isArray(pr.requested_teams) ? pr.requested_teams.length : 0
        const assignees = Array.isArray(pr.assignees) ? pr.assignees.length : 0
        if (requested === 0 && requestedTeams === 0 && assignees === 0) {
            risks.push({
                id: 'unassigned',
                label: 'No reviewers',
                tone: TONE.warning,
                hint: 'No reviewer or assignee — nobody owns this PR yet.',
            })
        } else if (requested > MAX_REQUESTED_REVIEWERS) {
            risks.push({
                id: 'reviewer-bystander',
                label: `${requested} reviewers`,
                tone: TONE.info,
                hint: `${requested} reviewers requested — diffuses ownership; bystander effect kicks in.`,
            })
        }
    }

    // Draft is informational — surface so the row reads honestly.
    if (pr.draft) {
        risks.push({
            id: 'draft',
            label: 'Draft',
            tone: TONE.neutral,
            hint: 'Marked as a draft — not yet ready for review.',
        })
    }

    return risks
}

/**
 * Convenience: pick the highest-severity risk for a compact summary
 * (e.g. a single "danger" dot when there's no room for full badges).
 */
export function highestSeverity(risks) {
    if (!risks?.length) return null
    const order = { [TONE.danger]: 3, [TONE.warning]: 2, [TONE.info]: 1, [TONE.neutral]: 0 }
    return [...risks].sort((a, b) => (order[b.tone] ?? 0) - (order[a.tone] ?? 0))[0] ?? null
}
