/**
 * GitHub pull_request event handler (Phase E1).
 *
 * Handled actions: opened, closed, reopened, review_requested,
 * review_request_removed, assigned, unassigned, labeled.
 *
 * Writes to:
 *   pr_events          — one row per event (idempotent via github_event_id UNIQUE)
 *   review_assignments — upserted on review_requested; updated on removal/close
 */
import db from '../../db.js';
import logger from '../logger.js';

const HANDLED_ACTIONS = new Set([
    'opened', 'closed', 'reopened',
    'review_requested', 'review_request_removed',
    'assigned', 'unassigned', 'labeled',
]);

/**
 * @param {object} payload  - Parsed GitHub webhook payload
 * @param {string} eventId  - X-GitHub-Delivery header value (dedup key)
 */
export async function handle(payload, eventId) {
    const pr = payload?.pull_request;
    if (!pr) {
        logger.debug({ eventId }, 'pull_request handler: missing pull_request field, skipping');
        return;
    }

    const action = payload.action;
    if (!action) return;

    const repo = payload.repository ?? {};
    const repoId = repo.id;
    const repoFullName = repo.full_name ?? '';
    const prNumber = pr.number;

    // Build reviewer / assignee JSON fields
    const requestedReviewerLogins = action === 'review_requested'
        ? JSON.stringify(
            [
                ...(payload.requested_reviewer ? [payload.requested_reviewer.login] : []),
                ...(pr.requested_reviewers ?? []).map((r) => r.login),
            ].filter((v, i, a) => a.indexOf(v) === i) // unique
        )
        : null;

    const assigneeLogins = (action === 'assigned' || action === 'unassigned')
        ? JSON.stringify((pr.assignees ?? []).map((a) => a.login))
        : null;

    // Insert pr_events row (INSERT OR IGNORE for idempotency)
    if (HANDLED_ACTIONS.has(action)) {
        try {
            db.prepare(`
                INSERT OR IGNORE INTO pr_events
                    (github_event_id, repo_id, repo_full_name, pr_number, action,
                     author_login, title, base_ref, head_ref, merged,
                     requested_reviewer_logins, assignee_logins)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                eventId,
                repoId,
                repoFullName,
                prNumber,
                action,
                pr.user?.login ?? null,
                pr.title ?? null,
                pr.base?.ref ?? null,
                pr.head?.ref ?? null,
                action === 'closed' ? (pr.merged === true ? 1 : 0) : null,
                requestedReviewerLogins,
                assigneeLogins,
            );
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT') {
                logger.debug({ eventId, action }, 'pull_request: duplicate event, skipping pr_events insert');
            } else {
                throw err;
            }
        }
    }

    // review_assignments side-effects
    if (action === 'review_requested') {
        const reviewers = [
            ...(payload.requested_reviewer ? [payload.requested_reviewer.login] : []),
            ...(pr.requested_reviewers ?? []).map((r) => r.login),
        ].filter((v, i, a) => v && a.indexOf(v) === i);

        for (const reviewerLogin of reviewers) {
            try {
                db.prepare(`
                    INSERT INTO review_assignments
                        (repo_id, repo_full_name, pr_number, reviewer_login, state)
                    VALUES (?, ?, ?, ?, 'pending')
                    ON CONFLICT (repo_id, pr_number, reviewer_login)
                    DO UPDATE SET state = 'pending', completed_at = NULL, requested_at = CURRENT_TIMESTAMP
                `).run(repoId, repoFullName, prNumber, reviewerLogin);
            } catch (err) {
                logger.error({ err, reviewerLogin, prNumber }, 'pull_request: failed to upsert review_assignment');
            }
        }
    }

    if (action === 'review_request_removed') {
        const reviewer = payload.requested_reviewer?.login;
        if (reviewer) {
            try {
                db.prepare(`
                    UPDATE review_assignments
                    SET state = 'dismissed', completed_at = CURRENT_TIMESTAMP
                    WHERE repo_id = ? AND pr_number = ? AND reviewer_login = ? AND state = 'pending'
                `).run(repoId, prNumber, reviewer);
            } catch (err) {
                logger.error({ err, reviewer, prNumber }, 'pull_request: failed to dismiss review_assignment');
            }
        }
    }

    if (action === 'closed') {
        try {
            db.prepare(`
                UPDATE review_assignments
                SET state = 'pr_closed', completed_at = CURRENT_TIMESTAMP
                WHERE repo_id = ? AND pr_number = ? AND state = 'pending'
            `).run(repoId, prNumber);
        } catch (err) {
            logger.error({ err, prNumber }, 'pull_request: failed to close review_assignments');
        }
    }
}
