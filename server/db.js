import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createDatabaseAdapter } from './lib/db-adapter.js';
import logger from './lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Initialise the database adapter.
//
// For SQLite (the default), this creates a thin wrapper around better-sqlite3
// that preserves the synchronous `db.prepare('SQL').get/all/run()` API used
// by every route in the codebase.
//
// For PostgreSQL (when DATABASE_URL is set), the adapter uses node-postgres
// and exposes the same interface with async methods.
//
// Top-level await is supported because the project uses ESM ("type": "module").
// ---------------------------------------------------------------------------
const db = await createDatabaseAdapter();

export function initDB(targetDb = db) {
    // Allow tests to apply the full schema against a throw-away in-memory
    // SQLite handle. Callers can pass any better-sqlite3-compatible connection.
    const db = targetDb;
    const transactions = db.transaction(() => {
        // Multi-tenancy migration: add user_id to tables that need it
        // If tables exist without user_id, drop and recreate them
        const ALLOWED_MIGRATION_TABLES = new Set(['repo_metadata', 'repo_embeddings', 'community_health_cache', 'workflow_runs', 'workflows_meta']);
        const tablesNeedingUserId = ['repo_metadata', 'repo_embeddings', 'community_health_cache', 'workflow_runs', 'workflows_meta'];
        for (const table of tablesNeedingUserId) {
            if (!ALLOWED_MIGRATION_TABLES.has(table)) throw new Error(`Unexpected table in migration: ${table}`);
            const cols = db.prepare(`PRAGMA table_info(${table})`).all();
            const hasUserId = cols.some(c => c.name === 'user_id');
            if (!hasUserId && cols.length > 0) {
                // Table exists but lacks user_id - recreate
                db.exec(`DROP TABLE IF EXISTS ${table}`);
            }
        }
        // Users Table (Local cache of GitHub users)
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, -- GitHub ID
                username TEXT NOT NULL,
                avatar_url TEXT,
                email TEXT,
                last_login TEXT DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Teams Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS teams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                owner_id INTEGER NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Team Members Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS team_members (
                team_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT CHECK(role IN ('owner', 'admin', 'member')) DEFAULT 'member',
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (team_id, user_id),
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Repo Assignments Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS repo_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id INTEGER NOT NULL,
                repo_full_name TEXT NOT NULL, -- e.g. "owner/repo"
                repo_id INTEGER NOT NULL,      -- GitHub Repo ID
                assigned_by INTEGER NOT NULL,
                assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (assigned_by) REFERENCES users(id)
            )
        `);

        // System Meta Table (For Setup Tracking)
        db.exec(`
            CREATE TABLE IF NOT EXISTS system_meta (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // AI Metadata Table (Cache for summarization)
        // Note: No foreign key - we can index any repo, not just assigned ones
        db.exec(`
            CREATE TABLE IF NOT EXISTS repo_metadata (
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                summary TEXT,
                topics TEXT, -- JSON array
                health_score INTEGER,
                last_indexed TEXT,
                PRIMARY KEY (user_id, repo_id)
            )
        `);

        // Vector Embeddings Table
        // We store the embedding as a JSON string for simplicity in SQLite
        // (For production with millions of rows, use a vector extension or specialized DB)
        db.exec(`
            CREATE TABLE IF NOT EXISTS repo_embeddings (
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                embedding TEXT NOT NULL, -- JSON string of float array
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, repo_id)
            )
        `);

        // Actions Statistics Tables
        db.exec(`
            CREATE TABLE IF NOT EXISTS workflow_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                github_run_id INTEGER UNIQUE NOT NULL,
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                workflow_id INTEGER NOT NULL,
                workflow_name TEXT NOT NULL,
                run_number INTEGER NOT NULL,
                status TEXT NOT NULL,
                conclusion TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                duration_seconds INTEGER,
                commit_sha TEXT,
                branch TEXT,
                event_type TEXT,
                actor_login TEXT,
                html_url TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.exec(`
            CREATE TABLE IF NOT EXISTS workflows_meta (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                github_workflow_id INTEGER UNIQUE NOT NULL,
                name TEXT NOT NULL,
                path TEXT,
                state TEXT DEFAULT 'active',
                last_run_at TEXT,
                total_runs INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                avg_duration_seconds INTEGER DEFAULT 0,
                last_success_at TEXT,
                last_failure_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo ON workflow_runs(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_user ON workflow_runs(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_conclusion ON workflow_runs(conclusion)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_date ON workflow_runs(started_at)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_meta_repo ON workflows_meta(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_meta_user ON workflows_meta(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_meta_state ON workflows_meta(state)`);

        // Community Health Cache
        db.exec(`
            CREATE TABLE IF NOT EXISTS community_health_cache (
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                health_score INTEGER NOT NULL,
                metrics TEXT NOT NULL,
                recommendations TEXT NOT NULL,
                analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, repo_id)
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_community_health_score ON community_health_cache(health_score DESC)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_community_health_user ON community_health_cache(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_metadata_user ON repo_metadata(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_embeddings_user ON repo_embeddings(user_id)`);

        // Migration jobs table for import tracking
        db.exec(`
            CREATE TABLE IF NOT EXISTS migration_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                source_type TEXT NOT NULL,
                source_url TEXT NOT NULL,
                source_name TEXT NOT NULL,
                target_owner TEXT NOT NULL,
                target_repo TEXT NOT NULL,
                target_full_name TEXT,
                status TEXT DEFAULT 'pending',
                progress_pct INTEGER DEFAULT 0,
                progress_message TEXT,
                error_message TEXT,
                started_at TEXT DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT,
                metadata TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_mig_user ON migration_jobs(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_mig_status ON migration_jobs(status)`);

        // Migration plans table (enhanced migration engine)
        db.exec(`
            CREATE TABLE IF NOT EXISTS migration_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                source_type TEXT NOT NULL DEFAULT 'azure',
                source_org TEXT NOT NULL,
                source_project TEXT NOT NULL,
                target_org TEXT,
                is_dry_run INTEGER NOT NULL DEFAULT 0,
                scheduled_at TEXT,
                credentials_enc TEXT,
                started_at TEXT,
                completed_at TEXT,
                ai_analysis TEXT,
                summary TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_user ON migration_plans(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_status ON migration_plans(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_scheduled ON migration_plans(scheduled_at) WHERE status = 'scheduled'`);

        // Migration tasks table (individual items within a plan)
        db.exec(`
            CREATE TABLE IF NOT EXISTS migration_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                execution_order INTEGER NOT NULL DEFAULT 0,
                source_ref TEXT NOT NULL,
                target_ref TEXT,
                config TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                progress_pct INTEGER NOT NULL DEFAULT 0,
                progress_message TEXT,
                error_message TEXT,
                retries INTEGER NOT NULL DEFAULT 0,
                max_retries INTEGER NOT NULL DEFAULT 3,
                started_at TEXT,
                completed_at TEXT,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES migration_plans(id) ON DELETE CASCADE
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_task_plan ON migration_tasks(plan_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_task_status ON migration_tasks(status)`);

        // Audit log for destructive operations
        db.exec(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                target TEXT NOT NULL,
                details TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`);

        // Enhanced audit log v2
        db.exec(`
            CREATE TABLE IF NOT EXISTS audit_log_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT,
                details TEXT,
                ip_address TEXT,
                user_agent TEXT,
                api_key_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_v2_user ON audit_log_v2(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_v2_action ON audit_log_v2(action)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_v2_resource ON audit_log_v2(resource_type, resource_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_v2_created ON audit_log_v2(created_at)`);

        // API Keys Table (for programmatic access)
        db.exec(`
            CREATE TABLE IF NOT EXISTS api_keys (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                key_hash TEXT NOT NULL UNIQUE,
                key_prefix TEXT NOT NULL,
                scopes TEXT NOT NULL DEFAULT '["read"]',
                last_used_at TEXT,
                last_used_ip TEXT,
                last_used_ua TEXT,
                expires_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                revoked_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`);

        // User Subscriptions Table (tier management)
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_subscriptions (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                tier TEXT NOT NULL DEFAULT 'free',
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT,
                current_period_start TEXT,
                current_period_end TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);

        // Webhook event ledger — used for idempotency. Stripe retries up to 5
        // times; recording the event id before processing prevents duplicate
        // subscription writes / proration drift.
        db.exec(`
            CREATE TABLE IF NOT EXISTS webhook_events (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                type TEXT,
                processed_at INTEGER NOT NULL
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_events_source ON webhook_events(source, processed_at)`);

        // Usage Metrics Table (billing metering)
        db.exec(`
            CREATE TABLE IF NOT EXISTS usage_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                metric_type TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_unique ON usage_metrics(user_id, metric_type, period_start)`);

        // License Keys Table (admin tracking for issued licenses)
        db.exec(`
            CREATE TABLE IF NOT EXISTS license_keys (
                id TEXT PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                license_key_hash TEXT NOT NULL UNIQUE,
                tier TEXT NOT NULL CHECK(tier IN ('pro', 'enterprise')),
                seats INTEGER NOT NULL DEFAULT 1,
                org_name TEXT,
                email TEXT,
                issued_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked_at TEXT,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_license_keys_hash ON license_keys(license_key_hash)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_license_keys_tier ON license_keys(tier)`);

        // Per-user AI configuration (BYOK — bring-your-own-key)
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_ai_config (
                user_id INTEGER PRIMARY KEY,
                completion_provider TEXT,
                completion_model TEXT,
                completion_credentials_enc TEXT,
                embedding_provider TEXT,
                embedding_model TEXT,
                embedding_credentials_enc TEXT,
                feature_overrides_json TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_user_ai_config_updated ON user_ai_config(updated_at)`);

        // -----------------------------------------------------------------------
        // GitHub Event Ingestion Pipeline (Phase E1)
        // -----------------------------------------------------------------------

        // PR lifecycle events — one row per distinct event
        db.exec(`
            CREATE TABLE IF NOT EXISTS pr_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                github_event_id TEXT,
                repo_id INTEGER NOT NULL,
                repo_full_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                action TEXT NOT NULL,
                author_login TEXT,
                title TEXT,
                base_ref TEXT,
                head_ref TEXT,
                merged INTEGER,
                first_commit_at DATETIME,
                requested_reviewer_logins TEXT,
                assignee_logins TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (github_event_id)
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pr_events_repo_pr ON pr_events(repo_id, pr_number)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pr_events_repo_created ON pr_events(repo_id, created_at)`);

        // Issue lifecycle events
        db.exec(`
            CREATE TABLE IF NOT EXISTS issue_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                github_event_id TEXT,
                repo_id INTEGER NOT NULL,
                repo_full_name TEXT NOT NULL,
                issue_number INTEGER NOT NULL,
                action TEXT NOT NULL,
                author_login TEXT,
                title TEXT,
                assignee_logins TEXT,
                labels TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (github_event_id)
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_issue_events_repo_issue ON issue_events(repo_id, issue_number)`);

        // Deployment events — DORA deploy frequency + MTTR
        db.exec(`
            CREATE TABLE IF NOT EXISTS deployment_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                github_event_id TEXT,
                repo_id INTEGER NOT NULL,
                repo_full_name TEXT NOT NULL,
                deployment_id INTEGER,
                environment TEXT,
                state TEXT,
                sha TEXT,
                ref TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (github_event_id)
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_deployment_events_repo_env_created ON deployment_events(repo_id, environment, created_at)`);

        // Active review assignments — derived view for cross-org review queue
        db.exec(`
            CREATE TABLE IF NOT EXISTS review_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_id INTEGER NOT NULL,
                repo_full_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                reviewer_login TEXT NOT NULL,
                requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                state TEXT DEFAULT 'pending',
                UNIQUE (repo_id, pr_number, reviewer_login)
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_review_assignments_reviewer_state ON review_assignments(reviewer_login, state)`);

        // Indexes for performance
        db.exec(`CREATE INDEX IF NOT EXISTS idx_members_user ON team_members(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repos_team ON repo_assignments(team_id)`);

        // Additional optimized indexes for frequent queries
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo_created ON workflow_runs(repo_id, created_at DESC)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_team_members_user_team ON team_members(user_id, team_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_assignments_repo ON repo_assignments(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_metadata_repo ON repo_metadata(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_embeddings_repo ON repo_embeddings(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_community_health_repo ON community_health_cache(repo_id)`);
        // Composite indexes for the hot AI/search paths that filter by both
        // user_id AND repo_id (e.g. `WHERE user_id = ? AND repo_id IN (...)`).
        // Single-column indexes still work but the composite is dramatically
        // cheaper for these IN-list lookups in routes/ai.js.
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_metadata_user_repo ON repo_metadata(user_id, repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_embeddings_user_repo ON repo_embeddings(user_id, repo_id)`);
    });

    transactions();

    // Migration 004: add feature_overrides_json column to user_ai_config.
    try {
        db.exec(`ALTER TABLE user_ai_config ADD COLUMN feature_overrides_json TEXT`);
    } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err;
    }

    // Migration 002: add is_mirror column + index to migration_jobs.
    // Split into two separate exec() calls so a "duplicate column" error on re-run
    // does not prevent the CREATE INDEX from executing.
    try {
        db.exec(`ALTER TABLE migration_jobs ADD COLUMN is_mirror INTEGER DEFAULT 0`);
    } catch (err) {
        // SQLite ALTER TABLE ADD COLUMN is not idempotent; guard against re-runs.
        if (!err.message?.includes('duplicate column')) throw err;
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_jobs_mirror
             ON migration_jobs(target_owner, target_repo, is_mirror)`);

    // Migration 003: add last_used_ip and last_used_ua columns to api_keys.
    try {
        db.exec(`ALTER TABLE api_keys ADD COLUMN last_used_ip TEXT`);
    } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err;
    }
    try {
        db.exec(`ALTER TABLE api_keys ADD COLUMN last_used_ua TEXT`);
    } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err;
    }

    // Migration 005 (G1 — SOC 2 CC7.2): append-only audit log hash chain.
    // Add prev_hash + row_hash columns to audit_log_v2.
    try {
        db.exec(`ALTER TABLE audit_log_v2 ADD COLUMN prev_hash TEXT NOT NULL DEFAULT ''`);
    } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err;
    }
    try {
        db.exec(`ALTER TABLE audit_log_v2 ADD COLUMN row_hash TEXT NOT NULL DEFAULT ''`);
    } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err;
    }

    // Append-only triggers — idempotent via IF NOT EXISTS.
    // All UPDATEs and DELETEs are unconditionally rejected; auditLog() uses a
    // single INSERT (no subsequent UPDATE), so these triggers never fire during
    // normal operation.
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS audit_log_v2_no_update
        BEFORE UPDATE ON audit_log_v2
        BEGIN
            SELECT RAISE(ABORT, 'audit_log_v2 is append-only; updates are not permitted');
        END
    `);
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS audit_log_v2_no_delete
        BEFORE DELETE ON audit_log_v2
        BEGIN
            SELECT RAISE(ABORT, 'audit_log_v2 is append-only; deletions are not permitted');
        END
    `);

    // Migration 006 (G3 — GDPR Article 17): tombstone columns on users table.
    try {
        db.exec(`ALTER TABLE users ADD COLUMN deleted_at TEXT`);
    } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err;
    }

    // Migration 007: issued_licenses table (Stripe → license key flow).
    db.exec(`
        CREATE TABLE IF NOT EXISTS issued_licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            stripe_subscription_id TEXT,
            stripe_session_id TEXT,
            tier TEXT NOT NULL,
            license_key TEXT NOT NULL,
            expires_at DATETIME,
            issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            email_delivered INTEGER DEFAULT 0,
            email_delivered_at DATETIME,
            UNIQUE (stripe_session_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_issued_licenses_user ON issued_licenses(user_id)`);

    // Migration 008 (G2 — data retention): warning_sent_at column on user_ai_config.
    try {
        db.exec(`ALTER TABLE user_ai_config ADD COLUMN warning_sent_at DATETIME`);
    } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err;
    }

    // Migration 009: add title column to issue_events (fixes /tech-debt 500).
    try {
        db.exec(`ALTER TABLE issue_events ADD COLUMN title TEXT`);
    } catch (err) {
        if (!err.message?.includes('duplicate column')) throw err;
    }

    // Migration 010 (Work Board mega-upgrade): live-data cache keyed by user+query.
    db.exec(`
        CREATE TABLE IF NOT EXISTS work_board_cache (
            user_id     INTEGER NOT NULL,
            query_type  TEXT    NOT NULL,
            payload     TEXT    NOT NULL,
            etag        TEXT,
            fetched_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at  DATETIME NOT NULL,
            PRIMARY KEY (user_id, query_type),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wbc_expires ON work_board_cache(expires_at)`);

    // Migration 011: snoozed PR/issue rows for Work Board.
    db.exec(`
        CREATE TABLE IF NOT EXISTS work_board_snooze (
            user_id        INTEGER NOT NULL,
            repo_full_name TEXT    NOT NULL,
            item_type      TEXT    NOT NULL,
            item_number    INTEGER NOT NULL,
            until_at       DATETIME NOT NULL,
            created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, repo_full_name, item_type, item_number),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wbs_until ON work_board_snooze(until_at)`);

    // Migration 012: saved filter presets.
    db.exec(`
        CREATE TABLE IF NOT EXISTS work_board_presets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            name       TEXT    NOT NULL,
            filters    TEXT    NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (user_id, name),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wbp_user ON work_board_presets(user_id)`);

    // Migration 013 (P1 — email resilience): dead-letter queue for undelivered
    // emails. Populated after the initial 3-attempt retry exhausts; a
    // background worker retries rows whose next_retry_at is in the past.
    db.exec(`
        CREATE TABLE IF NOT EXISTS email_dead_letter (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            to_address TEXT NOT NULL,
            subject TEXT NOT NULL,
            body_html TEXT,
            body_text TEXT,
            context_json TEXT,
            attempts INTEGER NOT NULL DEFAULT 1,
            last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            next_retry_at DATETIME,
            resolved_at DATETIME
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_email_dl_next_retry ON email_dead_letter(next_retry_at) WHERE resolved_at IS NULL`);

    // Migration 014 (P1 — webhook resilience): dead-letter queue for GitHub
    // webhook handler failures. The /api/v1/webhooks/github endpoint uses a
    // fast-ack pattern (200 before dispatch), so handler errors would
    // otherwise be lost silently. Rows inserted here are retried by
    // webhook-retry-worker with exponential backoff, capped at 10 attempts.
    // UNIQUE (delivery_id) prevents double-DLQ if the same delivery somehow
    // fails twice; the INSERT … ON CONFLICT in the route increments attempts
    // and refreshes last_error instead.
    db.exec(`
        CREATE TABLE IF NOT EXISTS webhook_events_dead_letter (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            delivery_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            last_error TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            next_retry_at DATETIME NOT NULL,
            resolved_at DATETIME
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_dl_next_retry
             ON webhook_events_dead_letter(next_retry_at)
             WHERE resolved_at IS NULL`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_dl_delivery
             ON webhook_events_dead_letter(delivery_id)`);

    // Migration 015 (perf): composite indexes on hot query paths flagged by the
    // performance audit. Each index below is added only where no existing index
    // is a covering leftmost-prefix; single-column indexes stay in place for
    // other queries (they remain useful and SQLite's planner picks whichever
    // is cheaper).
    //
    //   migration_jobs — Repo CRUD (mirrorMap) filters user_id + is_mirror
    //       (routes/repos/crud.js); import history / counters filter user_id +
    //       status (routes/import/status.js). Existing idx_migration_jobs_mirror
    //       starts with target_owner, so neither pair is covered.
    //   audit_log_v2 — routes/audit.js always filters user_id, often adds
    //       action and a created_at range, then ORDER BY created_at DESC.
    //       user_id + action + created_at lets the planner satisfy filter +
    //       sort from the index alone.
    //   issue_events / pr_events — lib/event-aggregations.js repeatedly picks
    //       the latest event per (repo_id, issue_number|pr_number) and filters
    //       by action ('opened' / 'closed'). Existing indexes stop at
    //       (repo_id, number); adding action as the third column covers the
    //       NOT EXISTS / MAX(id) correlated subqueries.
    //   work_board_snooze — listSnoozes() filters user_id AND until_at > now
    //       and orders by until_at DESC. The table PK starts with user_id but
    //       continues to repo_full_name, so range + sort on until_at can't use
    //       it efficiently.
    //
    // review_assignments(reviewer_login, state) is already covered by the
    // existing idx_review_assignments_reviewer_state — not re-added.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mig_user_mirror
             ON migration_jobs(user_id, is_mirror)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mig_user_status
             ON migration_jobs(user_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_v2_user_action_created
             ON audit_log_v2(user_id, action, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_issue_events_repo_issue_action
             ON issue_events(repo_id, issue_number, action)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pr_events_repo_pr_action
             ON pr_events(repo_id, pr_number, action)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wbs_user_until
             ON work_board_snooze(user_id, until_at)`);

    logger.info('SQLite Database initialized successfully');
}

/**
 * Seed mock data for development/demo mode
 * Only runs if MOCK_MODE is enabled and no teams exist for the mock user
 */
export function seedMockData() {
    const MOCK_USER_ID = 999999;

    // Check if mock user exists
    const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(MOCK_USER_ID);
    if (!existingUser) {
        db.prepare('INSERT OR IGNORE INTO users (id, username, avatar_url) VALUES (?, ?, ?)').run(
            MOCK_USER_ID, 'dev-user', 'https://github.com/ghost.png'
        );
    }

    // Check if mock teams already exist
    const existingTeams = db.prepare('SELECT COUNT(*) as count FROM teams WHERE owner_id = ?').get(MOCK_USER_ID);
    if (existingTeams.count > 0) {
        logger.info('Mock data already exists, skipping seed');
        return;
    }

    logger.info('Seeding mock data for demo mode...');

    const seedTransaction = db.transaction(() => {
        // Create mock teams
        const teams = [
            { name: 'Frontend Team', description: 'React, Vue, and Angular projects' },
            { name: 'Backend Team', description: 'Node.js, Python, and Go services' },
            { name: 'DevOps', description: 'Infrastructure and CI/CD pipelines' }
        ];

        teams.forEach((team, index) => {
            const insertTeam = db.prepare('INSERT INTO teams (name, description, owner_id) VALUES (?, ?, ?)');
            const info = insertTeam.run(team.name, team.description, MOCK_USER_ID);
            const teamId = info.lastInsertRowid;

            // Add mock user as owner
            db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(
                teamId, MOCK_USER_ID, 'owner'
            );

            // Assign some mock repos to each team
            const repoAssignments = [
                { repoId: index * 3 + 1, repoFullName: `dev-user/project-${index * 3 + 1}` },
                { repoId: index * 3 + 2, repoFullName: `dev-user/project-${index * 3 + 2}` },
                { repoId: index * 3 + 3, repoFullName: `dev-user/project-${index * 3 + 3}` }
            ];

            repoAssignments.forEach(repo => {
                db.prepare('INSERT INTO repo_assignments (team_id, repo_full_name, repo_id, assigned_by) VALUES (?, ?, ?, ?)').run(
                    teamId, repo.repoFullName, repo.repoId, MOCK_USER_ID
                );
            });
        });

        // Seed some mock AI metadata for repos
        const mockMetadata = [
            { repoId: 1, summary: 'A modern React dashboard with TypeScript and TailwindCSS', topics: '["react","typescript","dashboard"]', healthScore: 85 },
            { repoId: 2, summary: 'REST API built with Express.js and PostgreSQL', topics: '["nodejs","express","api"]', healthScore: 72 },
            { repoId: 3, summary: 'Python machine learning utilities and notebooks', topics: '["python","ml","data-science"]', healthScore: 68 }
        ];

        mockMetadata.forEach(meta => {
            db.prepare('INSERT OR REPLACE INTO repo_metadata (repo_id, user_id, summary, topics, health_score, last_indexed) VALUES (?, ?, ?, ?, ?, ?)').run(
                meta.repoId, MOCK_USER_ID, meta.summary, meta.topics, meta.healthScore, new Date().toISOString()
            );
        });
    });

    seedTransaction();
    logger.info('Mock data seeded successfully');
}

export default db;
