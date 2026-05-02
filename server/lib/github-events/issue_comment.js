// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GitHub `issue_comment` webhook handler.
 *
 * Note that GitHub fires this for both issue AND PR comments (PRs are issues
 * to GitHub's data model). We invalidate both caches to be safe — the cost
 * of an extra DELETE row is negligible.
 *
 * Handled actions: created, edited, deleted.
 */
import logger from '../logger.js';
import { invalidateByRepo } from '../gh-cache.js';

const HANDLED_ACTIONS = new Set(['created', 'edited', 'deleted']);

export async function handle(payload, eventId) {
    if (!HANDLED_ACTIONS.has(payload?.action)) return;

    const repoFullName = payload?.repository?.full_name;
    const issueNumber = payload?.issue?.number;

    if (!repoFullName || !issueNumber) {
        logger.debug({ eventId }, 'issue_comment: missing repo/issue fields');
        return;
    }

    const key = `${repoFullName}#${issueNumber}`;
    const dropped = invalidateByRepo(key, 'issue_comments')
        + invalidateByRepo(key, 'pull_comments')
        + invalidateByRepo(key, 'issues')
        + invalidateByRepo(key, 'pulls');

    logger.debug(
        { eventId, action: payload.action, repoFullName, issueNumber, dropped },
        '[gh-cache] invalidated issue/PR comment cache',
    );
}
