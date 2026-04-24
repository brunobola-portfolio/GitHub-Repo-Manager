// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Discovery — hits GitHub to surface repos where the user has active work.
 * Five parallel signal collectors, each returning a normalised shape.
 * Errors (403 SSO, 404, transient) degrade gracefully to empty arrays;
 * the orchestrator (runDiscovery, Task 8) unions them and persists.
 */

import { githubApi } from './github-api.js';

function repoFullNameFromUrl(repoUrl) {
    const m = repoUrl.match(/\/repos\/([^/]+\/[^/]+)$/);
    return m ? m[1] : null;
}

async function searchIssues(query, token) {
    // Encode the query but keep colons literal (GitHub search syntax uses them as field separators).
    // Only @, spaces, >, = and + need encoding; colons must stay unencoded for the pattern.
    const encodedQuery = query
        .replace(/@/g, '%40')
        .replace(/>/g, '%3E')
        .replace(/=/g, '%3D')
        .replace(/ /g, '+');
    const url = `/search/issues?q=${encodedQuery}&per_page=100`;
    try {
        const res = await githubApi(url, token);
        return res?.data?.items ?? [];
    } catch (err) {
        if (err?.status === 403) return [];
        throw err;
    }
}

export async function collectReviewRequested(token) {
    const items = await searchIssues('is:open archived:false review-requested:@me', token);
    return items.map(it => ({
        repo_full_name: repoFullNameFromUrl(it.repository_url),
        last_activity_at: it.updated_at,
        signal: 'review_requested',
    })).filter(r => r.repo_full_name);
}

export async function collectAuthoredPRs(token, windowDays) {
    const since = new Date(Date.now() - windowDays * 86400 * 1000).toISOString().slice(0, 10);
    const items = await searchIssues(`is:open is:pr archived:false author:@me updated:>=${since}`, token);
    return items.map(it => ({
        repo_full_name: repoFullNameFromUrl(it.repository_url),
        last_activity_at: it.updated_at,
        signal: 'authored_pr',
    })).filter(r => r.repo_full_name);
}

export async function collectAssignedIssues(token) {
    const items = await searchIssues('is:open is:issue archived:false assignee:@me', token);
    return items.map(it => ({
        repo_full_name: repoFullNameFromUrl(it.repository_url),
        last_activity_at: it.updated_at,
        signal: 'assigned_issue',
    })).filter(r => r.repo_full_name);
}

export async function collectOwnedRepos(token) {
    try {
        const res = await githubApi('/user/repos?affiliation=owner&sort=pushed&per_page=30', token);
        const items = res?.data ?? [];
        return items
            .filter(r => !r.archived)
            .map(r => ({
                repo_full_name: r.full_name,
                repo_id: r.id,
                last_activity_at: r.pushed_at,
                signal: 'owned',
            }));
    } catch (err) {
        if (err?.status === 403) return [];
        throw err;
    }
}

export async function collectRecentCommits(token, windowDays) {
    try {
        const meRes = await githubApi('/user', token);
        const login = meRes?.data?.login;
        if (!login) return [];

        const res = await githubApi(`/users/${login}/events?per_page=100`, token);
        const events = res?.data ?? [];
        const cutoff = Date.now() - windowDays * 86400 * 1000;

        const byRepo = new Map();
        for (const e of events) {
            if (e.type !== 'PushEvent') continue;
            if (new Date(e.created_at).getTime() < cutoff) continue;
            const repo = e.repo?.name;
            if (!repo) continue;
            if (!byRepo.has(repo) || byRepo.get(repo) < e.created_at) {
                byRepo.set(repo, e.created_at);
            }
        }

        return [...byRepo.entries()].map(([name, activity]) => ({
            repo_full_name: name,
            last_activity_at: activity,
            signal: 'recent_commit',
        }));
    } catch (err) {
        if (err?.status === 403) return [];
        throw err;
    }
}
