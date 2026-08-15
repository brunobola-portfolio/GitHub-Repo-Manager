// SPDX-License-Identifier: Apache-2.0
/**
 * GitHub `pull_request_review_comment` webhook handler.
 *
 * Lightweight: doesn't persist the comment itself (the diff/comment payload
 * is large and we rely on the read-through cache to surface live data). Its
 * only job is to invalidate any cached PR review/comment entries so the
 * next user view fetches fresh data from GitHub.
 *
 * Handled actions: created, edited, deleted.
 */
import logger from '../logger.js';
import { invalidateByRepo } from '../gh-cache.js';

const HANDLED_ACTIONS = new Set(['created', 'edited', 'deleted']);

export async function handle(payload, eventId) {
    if (!HANDLED_ACTIONS.has(payload?.action)) return;

    const repoFullName = payload?.repository?.full_name;
    const prNumber = payload?.pull_request?.number;

    if (!repoFullName || !prNumber) {
        logger.debug({ eventId }, 'pull_request_review_comment: missing repo/pr fields');
        return;
    }

    // Drop cached PR detail (which embeds review comments) and the dedicated
    // comments resource. We invalidate across all users since multiple
    // collaborators may have cached the same PR.
    const dropped = invalidateByRepo(`${repoFullName}#${prNumber}`, 'pulls')
        + invalidateByRepo(`${repoFullName}#${prNumber}`, 'pull_comments')
        + invalidateByRepo(`${repoFullName}#${prNumber}`, 'pull_reviews');

    logger.debug(
        { eventId, action: payload.action, repoFullName, prNumber, dropped },
        '[gh-cache] invalidated PR review-comment cache',
    );
}
