/**
 * GitHub issues event handler (Phase E1).
 *
 * Handled actions: opened, closed, reopened, assigned, unassigned, labeled.
 *
 * Writes to:
 *   issue_events — one row per event (idempotent via github_event_id UNIQUE)
 */
import db from '../../db.js';
import logger from '../logger.js';

const HANDLED_ACTIONS = new Set([
    'opened', 'closed', 'reopened', 'assigned', 'unassigned', 'labeled',
]);

/**
 * @param {object} payload  - Parsed GitHub webhook payload
 * @param {string} eventId  - X-GitHub-Delivery header value (dedup key)
 */
export async function handle(payload, eventId) {
    const issue = payload?.issue;
    if (!issue) {
        logger.debug({ eventId }, 'issues handler: missing issue field, skipping');
        return;
    }

    const action = payload.action;
    if (!action || !HANDLED_ACTIONS.has(action)) return;

    const repo = payload.repository ?? {};
    const repoId = repo.id;
    const repoFullName = repo.full_name ?? '';
    const issueNumber = issue.number;

    const assigneeLogins = JSON.stringify((issue.assignees ?? []).map((a) => a.login));
    const labels = JSON.stringify((issue.labels ?? []).map((l) => l.name));

    try {
        db.prepare(`
            INSERT OR IGNORE INTO issue_events
                (github_event_id, repo_id, repo_full_name, issue_number, action,
                 author_login, assignee_logins, labels)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            eventId,
            repoId,
            repoFullName,
            issueNumber,
            action,
            issue.user?.login ?? null,
            assigneeLogins,
            labels,
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
            logger.debug({ eventId, action }, 'issues: duplicate event, skipping insert');
        } else {
            throw err;
        }
    }
}
