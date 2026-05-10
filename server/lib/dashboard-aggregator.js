// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard aggregator — composes the Live Inbox by fanning out to existing
 * event-aggregation helpers. One module, one read path, one write path for
 * archive/snooze state. No GitHub round-trips here; live data flows through
 * gh-cache at the route layer.
 */

// db is imported for future use in Task 7 (snooze/archive filter).
// eslint-disable-next-line no-unused-vars
import db from '../db.js';
import { listMyPendingReviews, listMyOpenPRs, listMyOpenIssues } from './event-aggregations.js';

const SECTION_KEYS = ['needs_review', 'my_prs', 'mentions', 'failing_ci', 'stale_drafts', 'dependabot_ready'];

const SECTION_LABEL = {
    needs_review: 'Needs my review',
    my_prs: 'My open PRs',
    mentions: 'Mentions',
    failing_ci: 'Failing CI',
    stale_drafts: 'Stale drafts',
    dependabot_ready: 'Dependabot ready',
};

function prKey(repoFullName, prNumber) {
    return `pr:${repoFullName}#${prNumber}`;
}

function issueKey(repoFullName, issueNumber) {
    return `issue:${repoFullName}#${issueNumber}`;
}

function buildNeedsReview(userLogin) {
    const rows = listMyPendingReviews({ reviewerLogin: userLogin });
    return rows.map(r => ({
        id: prKey(r.repoFullName, r.prNumber),
        kind: 'pr',
        section: 'needs_review',
        repoFullName: r.repoFullName,
        prNumber: r.prNumber,
        title: r.title,
        authorLogin: r.authorLogin,
        since: r.requestedAt,
        ageHours: r.ageHours,
    }));
}

const SECTION_BUILDERS = {
    needs_review: (_userId, opts) => buildNeedsReview(opts.userLogin),
    my_prs: (_userId, opts) => {
        const rows = listMyOpenPRs({ authorLogin: opts.userLogin });
        return rows.map(r => ({
            id: prKey(r.repoFullName, r.prNumber),
            kind: 'pr',
            section: 'my_prs',
            repoFullName: r.repoFullName,
            prNumber: r.prNumber,
            title: r.title,
            authorLogin: r.authorLogin,
            since: r.openedAt,
            ageHours: r.ageHours,
        }));
    },
    mentions: (_userId, opts) => {
        const rows = listMyOpenIssues({ assigneeLogin: opts.userLogin });
        return rows.map(r => ({
            id: issueKey(r.repoFullName, r.issueNumber),
            kind: 'issue',
            section: 'mentions',
            repoFullName: r.repoFullName,
            issueNumber: r.issueNumber,
            title: r.title,
            since: r.openedAt,
            ageDays: r.ageDays,
        }));
    },
    failing_ci: () => [],
    stale_drafts: () => [],
    dependabot_ready: () => [],
};

/**
 * @param {number} userId
 * @param {object} opts
 * @param {string} opts.userLogin — GitHub login
 * @param {string[]} [opts.sections] — subset; defaults to all SECTION_KEYS
 * @param {boolean} [opts.includeArchived=false]
 * @returns {{ sections: Array<{ key, label, items: Array }> }}
 */
export function composeInbox(userId, opts = {}) {
    const { userLogin, sections = SECTION_KEYS } = opts;

    const out = sections
        .filter(k => SECTION_KEYS.includes(k))
        .map(key => ({
            key,
            label: SECTION_LABEL[key],
            items: SECTION_BUILDERS[key](userId, { userLogin }),
        }));

    return { sections: out };
}
