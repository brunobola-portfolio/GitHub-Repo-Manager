// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GitHub org membership helpers (slice 5 — org-shared prompts).
 *
 * Org-scoped prompt presets are visible to anyone who is an active member of
 * the GitHub org. Verifying membership requires a network call to GitHub
 * (`GET /user/memberships/orgs/{org}`) so we cache the answer per (user, org)
 * for 5 minutes via the existing `gh-cache.readThrough` infrastructure.
 *
 * The two public helpers:
 *   isOrgMember({session, org})            — true/false for one (user, org)
 *   filterOrgsByMembership({session, orgs}) — subset of orgs the user is in
 *   getCurrentUserOrgs({session})          — all orgs the session user belongs to
 *
 * All helpers fail closed: any error/missing-session resolves to "not a member"
 * (or empty list) rather than throwing. Org presets stay invisible if we can't
 * verify; that's the safe default.
 */
import { githubApi } from './github-api.js';
import { readThrough } from './gh-cache.js';
import logger from './logger.js';

const MEMBERSHIP_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Check whether the session's user is an active member of the given GitHub org.
 * Caches the answer per (user, org) for 5 minutes via gh-cache.
 *
 * @param {{session: {userId: number, accessToken: string}, org: string}} args
 * @returns {Promise<boolean>}
 */
export async function isOrgMember({ session, org }) {
    if (!session?.userId || !session?.accessToken || !org) return false;
    try {
        const result = await readThrough({
            userId: session.userId,
            resourceType: 'org-membership',
            resourceKey: String(org).toLowerCase(),
            ttlMs: MEMBERSHIP_CACHE_TTL_MS,
            fetcher: () => githubApi(
                `/user/memberships/orgs/${encodeURIComponent(org)}`,
                session.accessToken,
                { method: 'GET' },
            ),
        });
        return result?.data?.state === 'active';
    } catch (err) {
        // 404 → caller is not a member of that org. This is an expected miss,
        // not an error worth logging at warn level.
        if (err?.status === 404) return false;
        logger.warn(
            { err: err?.message, org, userId: session.userId },
            'Org membership check failed',
        );
        return false;
    }
}

/**
 * Bulk filter — given a list of org logins, return the subset the user is a
 * member of. Sequential under the hood (each is independently cached) so a
 * cache-warm caller pays close to zero cost.
 *
 * @param {{session: object, orgs: string[]}} args
 * @returns {Promise<string[]>}
 */
export async function filterOrgsByMembership({ session, orgs }) {
    if (!Array.isArray(orgs) || orgs.length === 0) return [];
    const checks = await Promise.all(
        orgs.map(async (org) => ({ org, member: await isOrgMember({ session, org }) })),
    );
    return checks.filter((c) => c.member).map((c) => c.org);
}

/**
 * Fetch the orgs the session user belongs to, via `GET /user/orgs`. Capped
 * at 100 (one page); users in more orgs would need pagination — out of scope
 * for slice 5. Cached for 5 minutes per user.
 *
 * @param {{session: object}} args
 * @returns {Promise<string[]>} array of org login strings
 */
export async function getCurrentUserOrgs({ session }) {
    if (!session?.userId || !session?.accessToken) return [];
    try {
        const result = await readThrough({
            userId: session.userId,
            resourceType: 'user-orgs',
            resourceKey: 'list',
            ttlMs: MEMBERSHIP_CACHE_TTL_MS,
            fetcher: () => githubApi(
                '/user/orgs?per_page=100',
                session.accessToken,
                { method: 'GET' },
            ),
        });
        const data = result?.data;
        return Array.isArray(data) ? data.map((o) => o?.login).filter(Boolean) : [];
    } catch (err) {
        logger.warn(
            { err: err?.message, userId: session.userId },
            'Failed to fetch user orgs',
        );
        return [];
    }
}
