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
 *
 * ---------------------------------------------------------------------------
 * ERASURE_REGISTRY — the single source of truth for every user-scoped table.
 *
 * Historically this route wiped a hand-enumerated list of ~15 tables, so every
 * NEW user-scoped table (encrypted Azure PATs, AI chat transcripts, gh_outbox
 * request bodies, work-board state, quota/spend counters, …) silently survived
 * "Erase my data". That is a GDPR Article-17 defect.
 *
 * The registry classifies EVERY table that carries a user-keyed column into one
 * of four fates. The companion COMPLETENESS TEST introspects the live schema
 * (sqlite_master + PRAGMA table_info) and fails if any table with a user-keyed
 * column is missing here — so a future table can never again be silently missed.
 *
 * action:
 *   'erase'     — rows for this user are DELETEd. `key.column` + `key.source`
 *                 (userId | login | email) say how to match the data subject.
 *   'cascade'   — no direct DELETE; rows disappear via ON DELETE CASCADE when
 *                 the parent (`via`) is erased. Documented so the test counts it.
 *   'tombstone' — the users row itself: PII columns nulled, deleted_at set, the
 *                 row is KEPT so audit foreign references stay valid.
 *   'survive'   — rows are intentionally retained; `reason` gives the legal /
 *                 integrity justification (audit trail, shared entity, system
 *                 config). These are never personal data of the erasing user
 *                 once the users row is tombstoned.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { auditLog } from '../lib/audit.js';
import db from '../db.js';
import logger from '../lib/logger.js';

const router = Router();

const CONFIRM_STRING = 'ERASE MY DATA';

/**
 * Column names that identify the user a row belongs to. Any table that carries
 * one of these MUST appear in ERASURE_REGISTRY (enforced by the completeness
 * test). These are ownership/actor columns — the ones that tie a row to a data
 * subject — not incidental references (e.g. workflow_runs.actor_login, which is
 * covered by that table's user_id).
 */
export const USER_KEY_COLUMNS = new Set([
    'user_id',
    'owner_id',
    'author_login',
    'reviewer_login',
    'assigned_by',
    'added_by',
    'installed_by',
    'to_address',
]);

export const ERASURE_REGISTRY = [
    // --- The user record itself -------------------------------------------
    { table: 'users', action: 'tombstone', key: { column: 'id', source: 'userId' },
      reason: 'users.id is the GitHub ID and is referenced by audit rows; PII columns are nulled and deleted_at is set instead of deleting the row.' },

    // --- Erased: personal data keyed by user_id ---------------------------
    { table: 'user_ai_config', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'user_ai_prompts', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'ai_pr_reviews', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'ai_review_prompts', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'ai_pr_commands', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'ai_pr_chat_messages', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'user_azure_credentials', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'migration_jobs', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    // migration_plans erase cascades to migration_tasks + migration_marks.
    { table: 'migration_plans', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'community_health_cache', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'repo_metadata', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'repo_embeddings', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'workflow_runs', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'workflows_meta', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'usage_metrics', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'api_keys', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'user_subscriptions', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'team_members', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'dashboard_inbox_state', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    // repo_assignments.assigned_by has no ON DELETE action; tombstoning the user
    // would otherwise leave dangling authorship rows, so wipe the ones this user created.
    { table: 'repo_assignments', action: 'erase', key: { column: 'assigned_by', source: 'userId' } },
    { table: 'issued_licenses', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'work_board_tracked_repos', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'work_board_prefs', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'work_board_ai_dismissed', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'work_board_undo_log', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'work_board_ai_spend', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'ai_spend', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'work_board_cache', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'work_board_snooze', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'work_board_presets', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'work_board_kpi_snapshots', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'gh_cache', action: 'erase', key: { column: 'user_id', source: 'userId' } },
    { table: 'gh_outbox', action: 'erase', key: { column: 'user_id', source: 'userId' } },

    // --- Erased: personal data keyed by the GitHub login ------------------
    { table: 'pr_events', action: 'erase', key: { column: 'author_login', source: 'login' } },
    { table: 'issue_events', action: 'erase', key: { column: 'author_login', source: 'login' } },
    { table: 'review_assignments', action: 'erase', key: { column: 'reviewer_login', source: 'login' } },

    // --- Erased: personal data keyed by the user's email address ----------
    { table: 'email_dead_letter', action: 'erase', key: { column: 'to_address', source: 'email' } },

    // --- Cascade: removed transitively via the parent's erase -------------
    { table: 'migration_tasks', action: 'cascade', via: 'migration_plans', key: { column: 'plan_id' },
      reason: 'Deleted via ON DELETE CASCADE from migration_plans.' },
    { table: 'migration_marks', action: 'cascade', via: 'migration_plans', key: { column: 'plan_id' },
      reason: 'Deleted via ON DELETE CASCADE from migration_plans (and migration_tasks).' },

    // --- Survive: intentionally retained ---------------------------------
    { table: 'audit_log_v2', action: 'survive', key: { column: 'user_id' },
      reason: 'Tamper-evident append-only hash chain. DELETE is rejected by triggers and would break the chain; retained for compliance.' },
    { table: 'teams', action: 'survive', key: { column: 'owner_id' },
      reason: 'Shared collaborative entity that may hold other members and repo assignments. Not deleted; owner_id references the tombstoned user.' },
    { table: 'azure_host_allowlist', action: 'survive', key: { column: 'added_by' },
      reason: 'Instance-wide admin configuration (allowed Azure hosts), not the erasing user\'s personal data. added_by is provenance only (ON DELETE SET NULL).' },
    { table: 'installed_license', action: 'survive', key: { column: 'installed_by' },
      reason: 'Instance-wide license singleton, not per-user personal data. installed_by is provenance only (ON DELETE SET NULL).' },
];

/**
 * Introspect a live SQLite schema and return every table that carries a
 * user-keyed column yet is NOT classified in ERASURE_REGISTRY. An empty array
 * means erasure coverage is structurally complete.
 * @param {object} liveDb - a better-sqlite3-compatible handle
 * @returns {Array<{ table: string, column: string }>}
 */
export function scanSchemaForUnclassifiedUserTables(liveDb) {
    const classified = new Set(ERASURE_REGISTRY.map((e) => e.table));
    const tables = liveDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((r) => r.name);

    const unclassified = [];
    for (const table of tables) {
        // Table names come from sqlite_master (trusted); safe to interpolate.
        const cols = liveDb.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
        const hit = cols.find((c) => USER_KEY_COLUMNS.has(c));
        if (hit && !classified.has(table)) unclassified.push({ table, column: hit });
    }
    return unclassified;
}

/**
 * Verify the registry itself against a live schema: every classified table must
 * exist and, when it declares a key column, that column must exist. Catches the
 * opposite drift (a registry entry for a renamed/dropped table/column).
 * @param {object} liveDb
 * @returns {string[]} human-readable problems; empty means consistent
 */
export function verifyRegistryConsistency(liveDb) {
    const problems = [];
    const schema = new Map();
    for (const { name } of liveDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
        schema.set(name, new Set(liveDb.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name)));
    }
    for (const entry of ERASURE_REGISTRY) {
        if (!schema.has(entry.table)) {
            problems.push(`registry table not found in schema: ${entry.table}`);
            continue;
        }
        const col = entry.key?.column;
        if (col && !schema.get(entry.table).has(col)) {
            problems.push(`registry key column missing: ${entry.table}.${col}`);
        }
    }
    return problems;
}

// Erase entries, in a FK-safe order (parents whose CASCADE we rely on are still
// simple row deletes here; we never delete the users row, so no RESTRICT bites).
const ERASE_ENTRIES = ERASURE_REGISTRY.filter((e) => e.action === 'erase');

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

        // Only query tables that exist in this deployment's schema so a partial
        // schema (or a not-yet-migrated table) never 500s the whole export.
        const existing = new Set(
            db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
        );
        const all = (table, sql, ...params) => (existing.has(table) ? db.prepare(sql).all(...params) : []);

        // Cap each table at MAX_EXPORT_ROWS to bound the in-memory JSON build
        // and the response size. Heavy-volume tables (webhook events,
        // workflow runs) on a long-tenured user could otherwise produce a
        // multi-GB JSON blob and OOM the process. We tag the payload with
        // a `truncated` map so the caller knows which tables were capped.
        const MAX_EXPORT_ROWS = 50_000;
        const truncated = {};
        const capped = (table, key, sql, ...params) => {
            if (!existing.has(table)) return [];
            const rows = db.prepare(`${sql} LIMIT ${MAX_EXPORT_ROWS + 1}`).all(...params);
            if (rows.length > MAX_EXPORT_ROWS) {
                truncated[key] = { limit: MAX_EXPORT_ROWS, note: 'export truncated; contact support for a full dump' };
                return rows.slice(0, MAX_EXPORT_ROWS);
            }
            return rows;
        };

        const payload = {
            exportedAt: new Date().toISOString(),
            schemaVersion: 2,
            user,
            aiConfig: all(
                'user_ai_config',
                // Explicit columns: NEVER export the encrypted credential blobs
                // (completion_credentials_enc / embedding_credentials_enc).
                `SELECT user_id, completion_provider, completion_model, embedding_provider,
                        embedding_model, feature_overrides_json, updated_at, warning_sent_at
                 FROM user_ai_config WHERE user_id = ?`,
                userId,
            ),
            subscriptions: all('user_subscriptions', 'SELECT * FROM user_subscriptions WHERE user_id = ?', userId),
            apiKeys: all(
                'api_keys',
                'SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ?',
                userId,
            ), // note: NEVER export key material — only the metadata
            migrationJobs: capped('migration_jobs', 'migrationJobs', 'SELECT * FROM migration_jobs WHERE user_id = ?', userId),
            migrationPlans: capped('migration_plans', 'migrationPlans', 'SELECT * FROM migration_plans WHERE user_id = ?', userId),
            prEvents: login ? capped('pr_events', 'prEvents', 'SELECT * FROM pr_events WHERE author_login = ?', login) : [],
            issueEvents: login ? capped('issue_events', 'issueEvents', 'SELECT * FROM issue_events WHERE author_login = ?', login) : [],
            reviewAssignments: login
                ? capped('review_assignments', 'reviewAssignments', 'SELECT * FROM review_assignments WHERE reviewer_login = ?', login)
                : [],
            communityHealthCache: all('community_health_cache', 'SELECT * FROM community_health_cache WHERE user_id = ?', userId),
            repoMetadata: all('repo_metadata', 'SELECT * FROM repo_metadata WHERE user_id = ?', userId),
            workflowRuns: capped('workflow_runs', 'workflowRuns', 'SELECT * FROM workflow_runs WHERE user_id = ?', userId),
            workflowsMeta: all('workflows_meta', 'SELECT * FROM workflows_meta WHERE user_id = ?', userId),
            usageMetrics: capped('usage_metrics', 'usageMetrics', 'SELECT * FROM usage_metrics WHERE user_id = ?', userId),
            teamMemberships: all('team_members', 'SELECT * FROM team_members WHERE user_id = ?', userId),

            // Extended portability set (schemaVersion 2). Secret material is
            // NEVER exported: Azure PATs (pat_encrypted) are excluded — only the
            // prefix/metadata — mirroring the api_keys rule above.
            azureCredentials: all(
                'user_azure_credentials',
                'SELECT id, user_id, label, host, org, pat_prefix, scopes, created_at, last_used_at FROM user_azure_credentials WHERE user_id = ?',
                userId,
            ),
            aiPrompts: all('user_ai_prompts', 'SELECT * FROM user_ai_prompts WHERE user_id = ?', userId),
            aiReviewPrompts: all('ai_review_prompts', 'SELECT * FROM ai_review_prompts WHERE user_id = ?', userId),
            aiPrReviews: capped(
                'ai_pr_reviews', 'aiPrReviews',
                'SELECT id, repo_owner, repo_name, pr_number, status, model_used, cost_usd, created_at, updated_at FROM ai_pr_reviews WHERE user_id = ?',
                userId,
            ),
            aiPrCommands: capped(
                'ai_pr_commands', 'aiPrCommands',
                'SELECT id, repo_owner, repo_name, pr_number, command, model_used, cost_usd, created_at, updated_at FROM ai_pr_commands WHERE user_id = ?',
                userId,
            ),
            aiPrChatMessages: capped(
                'ai_pr_chat_messages', 'aiPrChatMessages',
                'SELECT id, repo_owner, repo_name, pr_number, role, content, created_at FROM ai_pr_chat_messages WHERE user_id = ?',
                userId,
            ),
            workBoardPrefs: all('work_board_prefs', 'SELECT * FROM work_board_prefs WHERE user_id = ?', userId),
            workBoardTrackedRepos: capped('work_board_tracked_repos', 'workBoardTrackedRepos', 'SELECT * FROM work_board_tracked_repos WHERE user_id = ?', userId),
            workBoardPresets: all('work_board_presets', 'SELECT * FROM work_board_presets WHERE user_id = ?', userId),
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
        const user = db.prepare('SELECT id, username, email, deleted_at FROM users WHERE id = ?').get(userId);
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

        // Values used to match the data subject across the different key columns.
        const values = { userId, login: user.username, email: user.email };

        // Tables actually present in this deployment. In production initDB creates
        // every registry table, so nothing is skipped; the guard is a safety net
        // against schema drift / partial deployments so one missing table can't
        // abort the whole transactional wipe. The completeness test asserts every
        // registry table exists, so a skip here in prod would be a caught bug.
        const existing = new Set(
            db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
        );

        // --- Transactional wipe (registry-driven, FK order preserved) ---
        const wipe = db.transaction(() => {
            const deleted = {};
            const skipped = [];

            for (const entry of ERASE_ENTRIES) {
                if (!existing.has(entry.table)) { skipped.push(entry.table); continue; }
                const value = values[entry.key.source];
                if (value === null || value === undefined) { deleted[entry.table] = 0; continue; }
                // entry.table / entry.key.column are static trusted constants
                // (never user input); the matched value is always parameterized.
                const info = db.prepare(
                    `DELETE FROM ${entry.table} WHERE ${entry.key.column} = ?`
                ).run(value);
                deleted[entry.table] = info.changes;
            }

            // Tombstone the users row (preserve for audit referential integrity).
            // users.id IS the GitHub ID — we null the PII fields but keep the row
            // so that audit_log_v2.user_id foreign references remain valid.
            db.prepare(`
                UPDATE users
                SET email      = NULL,
                    username   = 'deleted-user',
                    avatar_url = NULL,
                    deleted_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(userId);

            return { deleted, skipped };
        });

        const { deleted, skipped } = wipe();

        if (skipped.length > 0) {
            logger.warn({ userId, skipped }, '[user-data] erasure skipped tables absent from schema');
        }
        logger.info({ userId }, '[user-data] Self-service erasure complete');

        // Destroy the session — user is now tombstoned. Respond only AFTER the
        // store settles so we don't return success while the session lingers; a
        // destroy failure is logged (the data wipe already succeeded regardless).
        req.session.destroy((destroyErr) => {
            if (destroyErr) logger.error({ err: destroyErr, userId }, '[user-data] failed to destroy session after erasure');
            res.status(200).json({
                deleted,
                tombstoned: ['user', 'audit_log_v2'],
            });
        });
        return;
    } catch (err) {
        logger.error({ err }, '[user-data] Erasure failed');
        return res.status(500).json({ error: 'Erasure failed — no data was changed' });
    }
});

export default router;
