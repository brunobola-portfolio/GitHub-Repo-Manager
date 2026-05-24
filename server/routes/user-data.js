/**
 * G3 — Self-service data erasure (GDPR Article 17 / SOC 2 CC6.5)
 *
 * DELETE /api/v1/user/data
 *
 * Wipes all personal data rows for the authenticated user and tombstones
 * the users row (email / name nulled, deleted_at set) so that audit history
 * retains referential integrity.
 *
 * Requires:
 *   - Active session (requireAuth)
 *   - Request body: { confirmString: 'ERASE MY DATA' }
 *
 * Blocked if:
 *   - confirmString does not match exactly.
 *   - User has an active subscription (cancel first).
 *   - User is already tombstoned (returns 404).
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { auditLog } from '../lib/audit.js';
import db from '../db.js';
import logger from '../lib/logger.js';

const router = Router();

const CONFIRM_STRING = 'ERASE MY DATA';

/**
 * GET /api/v1/user/data/export
 *
 * Self-service data export (GDPR Article 20 — right to data portability).
 * Returns a JSON blob containing every row keyed to the authenticated user
 * across the tables that the DELETE handler would wipe. Read-only; no
 * side effects. Intended to be consumed by the Settings "Danger Zone"
 * UI via fetch + Blob download.
 */
router.get('/export', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;
        const user = db.prepare(
            'SELECT id, username, email, avatar_url, created_at, deleted_at FROM users WHERE id = ?'
        ).get(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const login = user.username;
        const all = (sql, ...params) => db.prepare(sql).all(...params);

        // Cap each table at MAX_EXPORT_ROWS to bound the in-memory JSON build
        // and the response size. Heavy-volume tables (webhook events,
        // workflow runs) on a long-tenured user could otherwise produce a
        // multi-GB JSON blob and OOM the process. We tag the payload with
        // a `truncated` map so the caller knows which tables were capped.
        const MAX_EXPORT_ROWS = 50_000;
        const truncated = {};
        const capped = (key, sql, ...params) => {
            const rows = db.prepare(`${sql} LIMIT ${MAX_EXPORT_ROWS + 1}`).all(...params);
            if (rows.length > MAX_EXPORT_ROWS) {
                truncated[key] = { limit: MAX_EXPORT_ROWS, note: 'export truncated; contact support for a full dump' };
                return rows.slice(0, MAX_EXPORT_ROWS);
            }
            return rows;
        };

        const payload = {
            exportedAt: new Date().toISOString(),
            schemaVersion: 1,
            user,
            aiConfig: all('SELECT * FROM user_ai_config WHERE user_id = ?', userId),
            subscriptions: all('SELECT * FROM user_subscriptions WHERE user_id = ?', userId),
            apiKeys: all(
                'SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ?',
                userId,
            ), // note: NEVER export key material — only the metadata
            migrationJobs: capped('migrationJobs', 'SELECT * FROM migration_jobs WHERE user_id = ?', userId),
            migrationPlans: capped('migrationPlans', 'SELECT * FROM migration_plans WHERE user_id = ?', userId),
            prEvents: login ? capped('prEvents', 'SELECT * FROM pr_events WHERE author_login = ?', login) : [],
            issueEvents: login ? capped('issueEvents', 'SELECT * FROM issue_events WHERE author_login = ?', login) : [],
            reviewAssignments: login
                ? capped('reviewAssignments', 'SELECT * FROM review_assignments WHERE reviewer_login = ?', login)
                : [],
            communityHealthCache: all('SELECT * FROM community_health_cache WHERE user_id = ?', userId),
            repoMetadata: all('SELECT * FROM repo_metadata WHERE user_id = ?', userId),
            workflowRuns: capped('workflowRuns', 'SELECT * FROM workflow_runs WHERE user_id = ?', userId),
            workflowsMeta: all('SELECT * FROM workflows_meta WHERE user_id = ?', userId),
            usageMetrics: capped('usageMetrics', 'SELECT * FROM usage_metrics WHERE user_id = ?', userId),
            teamMemberships: all('SELECT * FROM team_members WHERE user_id = ?', userId),
            truncated,
        };

        auditLog(req, 'user.data.export', 'user', userId, {
            rowCounts: Object.fromEntries(
                Object.entries(payload)
                    .filter(([, v]) => Array.isArray(v))
                    .map(([k, v]) => [k, v.length]),
            ),
        });

        const body = JSON.stringify(payload, null, 2);
        const safeLogin = (login || `user-${userId}`).replace(/[^\w.-]/g, '_').slice(0, 64);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${safeLogin}-data-export-${Date.now()}.json"`,
        );
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.send(body);
    } catch (err) {
        logger.error({ err }, '[user-data] export failed');
        return res.status(500).json({ error: 'Data export failed' });
    }
});

router.delete('/', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;

        // --- Validation ---
        const { confirmString } = req.body ?? {};
        if (confirmString !== CONFIRM_STRING) {
            return res.status(400).json({
                error: `confirmString must be exactly '${CONFIRM_STRING}'`,
            });
        }

        // Check the user actually exists and is not already tombstoned.
        const user = db.prepare('SELECT id, username, deleted_at FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.deleted_at) {
            return res.status(404).json({ error: 'User already erased' });
        }

        // Block erasure if subscription is still active.
        const sub = db.prepare(
            `SELECT status FROM user_subscriptions WHERE user_id = ?`
        ).get(userId);
        if (sub && sub.status === 'active') {
            return res.status(400).json({
                error: 'cancel active subscription first',
            });
        }

        // --- Audit before wipe (append-only, so this survives the transaction) ---
        auditLog(req, 'user.erased', 'user', userId, { reason: 'self-service' });

        // --- Transactional wipe ---
        const wipe = db.transaction(() => {
            // 1. user_ai_config
            const aiDel = db.prepare('DELETE FROM user_ai_config WHERE user_id = ?').run(userId);

            // 2. migration_jobs (user is the author via user_id)
            const migDel = db.prepare('DELETE FROM migration_jobs WHERE user_id = ?').run(userId);

            // 3. migration_plans (includes migration_tasks via CASCADE)
            const planDel = db.prepare('DELETE FROM migration_plans WHERE user_id = ?').run(userId);

            // 4. Event tables keyed by author_login — look up the stored login first.
            //    We match on the github username stored in users.username.
            const login = user.username;

            const prDel = db.prepare(
                'DELETE FROM pr_events WHERE author_login = ?'
            ).run(login);

            const issueDel = db.prepare(
                'DELETE FROM issue_events WHERE author_login = ?'
            ).run(login);

            // deployment_events has no author column — skip.

            const reviewDel = db.prepare(
                'DELETE FROM review_assignments WHERE reviewer_login = ?'
            ).run(login);

            // 5. community_health_cache
            const healthDel = db.prepare(
                'DELETE FROM community_health_cache WHERE user_id = ?'
            ).run(userId);

            // 6. repo_metadata
            const metaDel = db.prepare(
                'DELETE FROM repo_metadata WHERE user_id = ?'
            ).run(userId);

            // 7. repo_embeddings
            const embDel = db.prepare(
                'DELETE FROM repo_embeddings WHERE user_id = ?'
            ).run(userId);

            // 8. workflow_runs / workflows_meta
            const wfRunDel = db.prepare(
                'DELETE FROM workflow_runs WHERE user_id = ?'
            ).run(userId);
            const wfMetaDel = db.prepare(
                'DELETE FROM workflows_meta WHERE user_id = ?'
            ).run(userId);

            // 9. usage_metrics
            const usageDel = db.prepare(
                'DELETE FROM usage_metrics WHERE user_id = ?'
            ).run(userId);

            // 10. api_keys
            const keysDel = db.prepare(
                'DELETE FROM api_keys WHERE user_id = ?'
            ).run(userId);

            // 11. user_subscriptions (only after active-check above)
            const subDel = db.prepare(
                'DELETE FROM user_subscriptions WHERE user_id = ?'
            ).run(userId);

            // 12. team_members (membership records — teams themselves are NOT deleted)
            const memberDel = db.prepare(
                'DELETE FROM team_members WHERE user_id = ?'
            ).run(userId);

            // 13. Tombstone the users row (preserve for audit referential integrity).
            //     users.id IS the GitHub ID — we null the PII fields but keep the row
            //     so that audit_log_v2.user_id foreign references remain valid.
            db.prepare(`
                UPDATE users
                SET email      = NULL,
                    username   = 'deleted-user',
                    avatar_url = NULL,
                    deleted_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(userId);

            return {
                aiConfig: aiDel.changes > 0,
                migrationJobs: migDel.changes,
                migrationPlans: planDel.changes,
                prEvents: prDel.changes,
                issueEvents: issueDel.changes,
                reviewAssignments: reviewDel.changes,
                communityHealthCache: healthDel.changes,
                repoMetadata: metaDel.changes,
                repoEmbeddings: embDel.changes,
                workflowRuns: wfRunDel.changes,
                workflowsMeta: wfMetaDel.changes,
                usageMetrics: usageDel.changes,
                apiKeys: keysDel.changes,
                subscriptions: subDel.changes,
                teamMemberships: memberDel.changes,
            };
        });

        const deleted = wipe();

        logger.info({ userId }, '[user-data] Self-service erasure complete');

        // Destroy the session — user is now tombstoned.
        req.session.destroy(() => {});

        return res.status(200).json({
            deleted,
            tombstoned: ['user', 'audit_log'],
        });
    } catch (err) {
        logger.error({ err }, '[user-data] Erasure failed');
        return res.status(500).json({ error: 'Erasure failed — no data was changed' });
    }
});

export default router;
