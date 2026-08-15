// SPDX-License-Identifier: Apache-2.0
/**
 * Live cross-repo GitHub fetchers used by the Work Board when webhook data
 * is missing or stale. Each function calls the shared githubApi() wrapper —
 * ETag revalidation, 304 caching, and rate-limit tracking are handled there.
 *
 * Returned shape matches the existing event-aggregations output so the route
 * layer is agnostic about origin.
 */
import { githubApi } from './github-api.js';

export const DEFAULT_DEBT_LABELS = [
    'tech-debt', 'technical-debt', 'technical debt',
    'debt', 'refactor', 'refactoring', 'code-smell', 'cleanup',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractRepoFullName(issue) {
    const match = /\/repos\/([^/]+\/[^/]+)$/.exec(issue.repository_url || '');
    return match ? match[1] : (issue.repository?.full_name || '');
}

function hoursSince(iso) { return (Date.now() - new Date(iso).getTime()) / 3_600_000; }
function daysSince(iso) { return (Date.now() - new Date(iso).getTime()) / 86_400_000; }

async function callSearch({ token, q, perPage = 100 }) {
    const path = `/search/issues?q=${encodeURIComponent(q)}&per_page=${perPage}&sort=updated&order=desc`;
    const { data } = await githubApi(path, token);
    return {
        items: Array.isArray(data?.items) ? data.items : [],
        totalCount: data?.total_count ?? 0,
    };
}

/**
 * Normalise a GitHub /search/issues PR item.
 *
 * Note on time fields:
 *   - `ageHours` is hours since `updated_at` — "how stale has activity been?"
 *   - `ageDays`  is days since `created_at` — "how long has this PR existed?"
 * The two intentionally use different source timestamps because reviewers
 * care about both dimensions (activity freshness vs. overall age).
 */
function normalisePR(issue) {
    return {
        repoFullName: extractRepoFullName(issue),
        prNumber: issue.number,
        title: issue.title || null,
        authorLogin: issue.user?.login || null,
        requestedAt: issue.updated_at,
        ageHours: Math.round(hoursSince(issue.updated_at) * 10) / 10,
        ageDays: Math.round(daysSince(issue.created_at) * 10) / 10,
        openedAt: issue.created_at,
    };
}

function normaliseIssue(issue) {
    return {
        repoFullName: extractRepoFullName(issue),
        issueNumber: issue.number,
        title: issue.title || null,
        authorLogin: issue.user?.login || null,
        labels: (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name)).filter(Boolean),
        assignees: (issue.assignees || []).map(a => a.login).filter(Boolean),
        openedAt: issue.created_at,
        ageDays: Math.round(daysSince(issue.created_at) * 10) / 10,
    };
}

// ---------------------------------------------------------------------------
// Public fetchers
// ---------------------------------------------------------------------------

export async function fetchMyPendingReviews({ token, login, limit = 100 }) {
    const q = `review-requested:${login} is:open is:pr archived:false`;
    const r = await callSearch({ token, q, perPage: limit });
    return { ...r, items: r.items.map(normalisePR) };
}

export async function fetchMyOpenPRs({ token, login, limit = 100 }) {
    const q = `author:${login} is:open is:pr archived:false`;
    const r = await callSearch({ token, q, perPage: limit });
    return { ...r, items: r.items.map(normalisePR) };
}

export async function fetchStalePRs({ token, login, staleAfterDays = 7, limit = 100 }) {
    const cutoff = new Date(Date.now() - staleAfterDays * 86_400_000).toISOString().slice(0, 10);
    const q = `author:${login} is:open is:pr updated:<${cutoff} archived:false`;
    const r = await callSearch({ token, q, perPage: limit });
    return { ...r, items: r.items.map(normalisePR) };
}

export async function fetchMyOpenIssues({ token, login, limit = 100 }) {
    const q = `assignee:${login} is:open is:issue archived:false`;
    const r = await callSearch({ token, q, perPage: limit });
    return { ...r, items: r.items.map(normaliseIssue) };
}

export async function fetchTechDebtIssues({ token, labels, limit = 100 }) {
    const filtered = Array.isArray(labels) ? labels.filter(l => l != null).map(l => String(l).trim()).filter(Boolean) : [];
    const effectiveLabels = filtered.length > 0 ? filtered : DEFAULT_DEBT_LABELS;
    const labelQ = effectiveLabels.map(l => `label:"${l}"`).join(' OR ');
    const q = `is:open is:issue archived:false (${labelQ})`;
    const r = await callSearch({ token, q, perPage: limit });
    return { ...r, items: r.items.map(normaliseIssue) };
}
