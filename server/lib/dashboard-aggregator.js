// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard aggregator — composes the Live Inbox by fanning out to existing
 * event-aggregation helpers. One module, one read path, one write path for
 * archive/snooze state. No GitHub round-trips here; live data flows through
 * gh-cache at the route layer.
 */

import db from '../db.js';
import { listMyPendingReviews, listMyOpenPRs, listMyOpenIssues, listStalePRs } from './event-aggregations.js';

const SECTION_KEYS = ['needs_review', 'my_prs', 'mentions', 'failing_ci', 'stale_drafts', 'dependabot_ready'];

const SECTION_LABEL = {
    needs_review: 'Needs my review',
    my_prs: 'My open PRs',
    mentions: 'Mentions',
    failing_ci: 'Failing CI',
    stale_drafts: 'Stale drafts',
    dependabot_ready: 'Dependabot ready',
};

// Priority order — earlier sections "win" ownership of a duplicated id.
// Failing CI is most urgent → it claims the PR if also in my_prs.
const SECTION_PRIORITY = ['failing_ci', 'needs_review', 'stale_drafts', 'mentions', 'dependabot_ready', 'my_prs'];

function prKey(repoFullName, prNumber) {
    return `pr:${repoFullName}#${prNumber}`;
}

function issueKey(repoFullName, issueNumber) {
    return `issue:${repoFullName}#${issueNumber}`;
}

function loadInboxState(userId) {
    const rows = db.prepare(
        'SELECT item_id, archived_at, snoozed_until FROM dashboard_inbox_state WHERE user_id = ?'
    ).all(userId);
    const archived = new Set();
    const snoozedUntil = new Map();
    for (const r of rows) {
        if (r.archived_at) archived.add(r.item_id);
        if (r.snoozed_until) snoozedUntil.set(r.item_id, r.snoozed_until);
    }
    return { archived, snoozedUntil };
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
    // Phase 2 (DORA card): wire gh-cache CI status for items in my_prs
    failing_ci: () => [],
    stale_drafts: (_userId, opts) => {
        const rows = listStalePRs({ staleAfterDays: 7 });
        return rows
            .filter(r => r.authorLogin === opts.userLogin)
            .map(r => ({
                id: prKey(r.repoFullName, r.prNumber),
                kind: 'pr',
                section: 'stale_drafts',
                repoFullName: r.repoFullName,
                prNumber: r.prNumber,
                title: r.title,
                authorLogin: r.authorLogin,
                since: r.openedAt,
                ageDays: r.ageDays,
            }));
    },
    // Phase 3 (scorecard): wire repos-security.listDependabotReadyToMerge
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
    const { userLogin, sections = SECTION_KEYS, includeArchived = false } = opts;
    const requested = sections.filter(k => SECTION_KEYS.includes(k));
    const { archived, snoozedUntil } = loadInboxState(userId);
    const now = Date.now();

    const raw = {};
    for (const key of requested) {
        raw[key] = SECTION_BUILDERS[key](userId, { userLogin }).filter(item => {
            if (!includeArchived && archived.has(item.id)) return false;
            const snoozeIso = snoozedUntil.get(item.id);
            if (snoozeIso && Date.parse(snoozeIso) > now) return false;
            return true;
        });
    }

    const owned = new Set();
    const dedupBySection = {};
    for (const key of SECTION_PRIORITY) {
        if (!raw[key]) continue;
        dedupBySection[key] = raw[key].filter(item => {
            if (owned.has(item.id)) return false;
            owned.add(item.id);
            return true;
        });
    }

    return {
        sections: requested.map(key => ({
            key,
            label: SECTION_LABEL[key],
            items: dedupBySection[key] ?? [],
        })),
    };
}
