/**
 * GitHub pull_request_review event handler (Phase E1).
 *
 * Handled actions: submitted, dismissed.
 *
 * Writes to:
 *   pr_events          — one row with action='reviewed'
 *   review_assignments — marks state='submitted' on review submission
 */
import db from '../../db.js';
import logger from '../logger.js';

/**
 * @param {object} payload  - Parsed GitHub webhook payload
 * @param {string} eventId  - X-GitHub-Delivery header value (dedup key)
 */
export async function handle(payload, eventId) {
    const review = payload?.review;
    const pr = payload?.pull_request;
    if (!review || !pr) {
        logger.debug({ eventId }, 'pull_request_review handler: missing review or pull_request, skipping');
        return;
    }

    const action = payload.action;
    if (action !== 'submitted' && action !== 'dismissed') return;

    const repo = payload.repository ?? {};
    const repoId = repo.id;
    const repoFullName = repo.full_name ?? '';
    const prNumber = pr.number;
    const reviewerLogin = review.user?.login ?? null;

    // Insert pr_events row with action='reviewed'
    try {
        db.prepare(`
            INSERT OR IGNORE INTO pr_events
                (github_event_id, repo_id, repo_full_name, pr_number, action,
                 author_login, title, base_ref, head_ref)
            VALUES (?, ?, ?, ?, 'reviewed', ?, ?, ?, ?)
        `).run(
            eventId,
            repoId,
            repoFullName,
            prNumber,
            reviewerLogin,
            pr.title ?? null,
            pr.base?.ref ?? null,
            pr.head?.ref ?? null,
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
            logger.debug({ eventId }, 'pull_request_review: duplicate event, skipping pr_events insert');
        } else {
            throw err;
        }
    }

    // Mark the matching review_assignment as submitted
    if (action === 'submitted' && reviewerLogin) {
        try {
            db.prepare(`
                UPDATE review_assignments
                SET state = 'submitted', completed_at = CURRENT_TIMESTAMP
                WHERE repo_id = ? AND pr_number = ? AND reviewer_login = ? AND state = 'pending'
            `).run(repoId, prNumber, reviewerLogin);
        } catch (err) {
            logger.error({ err, reviewerLogin, prNumber }, 'pull_request_review: failed to update review_assignment');
        }
    }
}
