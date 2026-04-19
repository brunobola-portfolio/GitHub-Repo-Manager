/**
 * GitHub deployment_status event handler (Phase E1).
 *
 * Writes to:
 *   deployment_events — one row per event (idempotent via github_event_id UNIQUE)
 *
 * Supports DORA deploy frequency and MTTR calculations (E2+).
 */
import db from '../../db.js';
import logger from '../logger.js';

/**
 * @param {object} payload  - Parsed GitHub webhook payload
 * @param {string} eventId  - X-GitHub-Delivery header value (dedup key)
 */
export async function handle(payload, eventId) {
    const deploymentStatus = payload?.deployment_status;
    const deployment = payload?.deployment;
    if (!deploymentStatus || !deployment) {
        logger.debug({ eventId }, 'deployment_status handler: missing deployment_status or deployment, skipping');
        return;
    }

    const repo = payload.repository ?? {};
    const repoId = repo.id;
    const repoFullName = repo.full_name ?? '';

    try {
        db.prepare(`
            INSERT OR IGNORE INTO deployment_events
                (github_event_id, repo_id, repo_full_name, deployment_id,
                 environment, state, sha, ref)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            eventId,
            repoId,
            repoFullName,
            deployment.id ?? null,
            deployment.environment ?? null,
            deploymentStatus.state ?? null,
            deployment.sha ?? null,
            deployment.ref ?? null,
        );
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
            logger.debug({ eventId }, 'deployment_status: duplicate event, skipping insert');
        } else {
            throw err;
        }
    }
}
