// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard aggregator — composes the Live Inbox by fanning out to existing
 * event-aggregation helpers (webhook/DB fallback) or live GitHub Search
 * fetchers (when a token is present). One module, one read path, one write
 * path for archive/snooze state.
 *
 * Strategy: live-first per section. If a token is supplied the GitHub Search
 * fetcher is called; on error (rate-limit, network) the webhook/DB query is
 * used as a fallback so one bad section never blanks the whole inbox.
 */

import db from '../db.js';
import { listMyPendingReviews, listMyOpenPRs, listMyOpenIssues, listStalePRs } from './event-aggregations.js';
import {
    fetchMyPendingReviews,
    fetchMyOpenPRs,
    fetchMyOpenIssues,
    fetchStalePRs,
} from './work-board-github.js';

// `failing_ci` and `dependabot_ready` were stubs reserved for Premium Dashboard
// Phase 2 (DORA) and Phase 3 (Scorecards). They were enumerated alongside live
// sections, which surfaced two permanently-empty rows to every user. Removed
// from the live shape until the backing data wiring lands; re-add to both
// SECTION_KEYS and SECTION_CONFIG together when implementing.
const SECTION_KEYS = ['needs_review', 'my_prs', 'mentions', 'stale_drafts'];

// Priority order — earlier sections "win" ownership of a duplicated id.
const SECTION_PRIORITY = ['needs_review', 'stale_drafts', 'mentions', 'my_prs'];

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

// Per-section config: a live GitHub-Search fetcher (used when a token is
// present), a webhook/DB fallback (used otherwise or when live errors), and a
// shared row->item mapper. Live and DB sources return the same normalized field
// names, so one mapper serves both.
const SECTION_CONFIG = {
    needs_review: {
        label: 'Needs my review',
        live: ({ token, login }) => fetchMyPendingReviews({ token, login }).then(r => r.items),
        fallback: ({ login }) => listMyPendingReviews({ reviewerLogin: login }),
        map: (r) => ({
            id: prKey(r.repoFullName, r.prNumber), kind: 'pr', section: 'needs_review',
            repoFullName: r.repoFullName, prNumber: r.prNumber, title: r.title,
            authorLogin: r.authorLogin, since: r.requestedAt, ageHours: r.ageHours,
        }),
    },
    my_prs: {
        label: 'My open PRs',
        live: ({ token, login }) => fetchMyOpenPRs({ token, login }).then(r => r.items),
        fallback: ({ login }) => listMyOpenPRs({ authorLogin: login }),
        map: (r) => ({
            id: prKey(r.repoFullName, r.prNumber), kind: 'pr', section: 'my_prs',
            repoFullName: r.repoFullName, prNumber: r.prNumber, title: r.title,
            authorLogin: r.authorLogin, since: r.openedAt, ageHours: r.ageHours,
        }),
    },
    mentions: {
        label: 'Mentions',
        live: ({ token, login }) => fetchMyOpenIssues({ token, login }).then(r => r.items),
        fallback: ({ login }) => listMyOpenIssues({ assigneeLogin: login }),
        map: (r) => ({
            id: issueKey(r.repoFullName, r.issueNumber), kind: 'issue', section: 'mentions',
            repoFullName: r.repoFullName, issueNumber: r.issueNumber, title: r.title,
            since: r.openedAt, ageDays: r.ageDays,
        }),
    },
    stale_drafts: {
        label: 'Stale drafts',
        live: ({ token, login }) => fetchStalePRs({ token, login }).then(r => r.items),
        fallback: ({ login }) => listStalePRs({ staleAfterDays: 7 }).filter(r => r.authorLogin === login),
        map: (r) => ({
            id: prKey(r.repoFullName, r.prNumber), kind: 'pr', section: 'stale_drafts',
            repoFullName: r.repoFullName, prNumber: r.prNumber, title: r.title,
            authorLogin: r.authorLogin, since: r.openedAt, ageDays: r.ageDays,
        }),
    },
};

/**
 * Source one section's items. Live-first when a token is present; on live error
 * (rate limit, network) fall back to the webhook/DB query so one bad section
 * never blanks the whole inbox.
 */
async function sourceSection(key, { token, login, logger }) {
    const cfg = SECTION_CONFIG[key];
    if (token) {
        try {
            const rows = await cfg.live({ token, login });
            return rows.map(cfg.map);
        } catch (err) {
            logger?.warn?.({ err, section: key }, 'inbox live fetch failed; falling back to webhook data');
        }
    }
    return cfg.fallback({ login }).map(cfg.map);
}

/**
 * @param {number} userId
 * @param {object} opts
 * @param {string} opts.userLogin — GitHub login
 * @param {string|null} [opts.token] — GitHub access token; when present, sections use live search
 * @param {string[]} [opts.sections] — subset; defaults to all SECTION_KEYS
 * @param {boolean} [opts.includeArchived=false]
 * @param {object} [opts.logger] — request logger (optional)
 * @returns {Promise<{ sections: Array<{ key, label, items: Array }> }>}
 */
export async function composeInbox(userId, opts = {}) {
    const { userLogin, token = null, sections = SECTION_KEYS, includeArchived = false, logger = null } = opts;
    const requested = sections.filter(k => SECTION_KEYS.includes(k));
    const { archived, snoozedUntil } = loadInboxState(userId);
    const now = Date.now();

    const sourced = await Promise.all(
        requested.map(async key => [key, await sourceSection(key, { token, login: userLogin, logger })]),
    );

    const raw = {};
    for (const [key, items] of sourced) {
        raw[key] = items.filter(item => {
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
        meta: { live: !!token },
        sections: requested.map(key => ({
            key,
            label: SECTION_CONFIG[key].label,
            items: dedupBySection[key] ?? [],
        })),
    };
}
