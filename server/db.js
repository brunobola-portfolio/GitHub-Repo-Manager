import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createDatabaseAdapter } from './lib/db-adapter.js';
import logger from './lib/logger.js';
import { runMigrations } from './lib/db-migrations.js';
import { bindLicenseRevocationStore } from './lib/license.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Initialise the database adapter.
//
// SQLite (better-sqlite3) is the only supported backend. This creates a thin
// wrapper around better-sqlite3 that preserves the synchronous
// `db.prepare('SQL').get/all/run()` API used by every route in the codebase.
//
// A `DATABASE_URL` that points at PostgreSQL fails fast here with a clear
// error — see docs/operations.md.
//
// Top-level await is supported because the project uses ESM ("type": "module").
// ---------------------------------------------------------------------------
const db = await createDatabaseAdapter();

// Point license verification at the revocation list (migration 032). This has to
// happen here rather than inside lib/license.js: that module is also imported by
// the offline signing tools (scripts/generate-license.js, scripts/lib/minter.js),
// which must never open — let alone create — an install's manager.db. This file
// is the one entry point every server process goes through to reach SQLite, so
// binding here is what makes verifyLicenseKey() consult the list everywhere
// (require-tier's cache refresh, routes/license.js) with no per-caller wiring.
// The table may not exist yet — initDB() runs later — which getLicenseRevocation
// handles by re-probing until it does.
bindLicenseRevocationStore(db);

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

        // Migration marks table (provenance marks written to source/destination/git after a migration)
        db.exec(`
            CREATE TABLE IF NOT EXISTS migration_marks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id INTEGER NOT NULL,
                task_id INTEGER,
                scope TEXT NOT NULL,
                target_kind TEXT NOT NULL,
                target_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                skip_reason TEXT,
                error_message TEXT,
                written_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES migration_plans(id) ON DELETE CASCADE,
                FOREIGN KEY (task_id) REFERENCES migration_tasks(id) ON DELETE CASCADE
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_marks_plan ON migration_marks(plan_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_marks_status ON migration_marks(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_marks_target ON migration_marks(target_kind, target_id)`);
        // ORDER BY created_at DESC LIMIT 200 in routes/migration-marks.js. Without
        // this the unfiltered listing sorts the whole table.
        db.exec(`CREATE INDEX IF NOT EXISTS idx_marks_created ON migration_marks(created_at DESC)`);

        // NOTE: the legacy v1 `audit_log` table has been removed. Every audit
        // write goes to `audit_log_v2` (hash-chained, append-only — see
        // lib/audit.js); v1 had no production reader or writer. Existing
        // databases have the dead table dropped by db-migrations.js migration 28.

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

        // NOTE: the legacy `license_keys` table has been removed. Issued licenses
        // are tracked in `issued_licenses` (lib/license-issuer.js) and the active
        // self-hosted license lives in the `installed_license` singleton;
        // `license_keys` had no production reader or writer. Existing databases
        // have the dead table dropped by db-migrations.js migration 28.

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

        // Per-user, per-feature AI prompt overrides. The default prompt for
        // each feature lives in code (server/lib/ai-prompt-registry.js); this
        // table only stores the user's custom version when they choose to
        // override one. Rows are identified by `feature_key` strings declared
        // in the registry, so unrecognized keys are filtered at the route layer.
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_ai_prompts (
                user_id INTEGER NOT NULL,
                feature_key TEXT NOT NULL,
                prompt TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, feature_key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_user_ai_prompts_user ON user_ai_prompts(user_id)`);

        // AI Deep Review drafts — premium PR review surface.
        // One row per (user, repo, pr_number). The draft_json blob holds the
        // full structured review (walkthrough + line comments). last_reviewed_sha
        // is the head SHA the AI saw — used to skip re-review when nothing
        // changed and to compute incremental deltas via /compare.
        db.exec(`
            CREATE TABLE IF NOT EXISTS ai_pr_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                last_reviewed_sha TEXT NOT NULL,
                draft_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                github_review_id INTEGER,
                cost_usd REAL,
                model_used TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, repo_owner, repo_name, pr_number),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_pr_reviews_lookup ON ai_pr_reviews(repo_owner, repo_name, pr_number)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_pr_reviews_user ON ai_pr_reviews(user_id, status)`);

        // AI Deep Review — Prompt Studio (slice 1b premium feature).
        // Multi-preset library at user/repo/org scope. The simpler single-prompt-
        // per-user `user_ai_prompts` table from earlier slices stays for the
        // built-in prompt overrides; this table holds the richer preset library.
        db.exec(`
            CREATE TABLE IF NOT EXISTS ai_review_prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                scope TEXT NOT NULL CHECK(scope IN ('user', 'repo', 'org')),
                scope_target TEXT,
                preset_key TEXT NOT NULL,
                name TEXT NOT NULL,
                system_prompt TEXT NOT NULL,
                path_rules_json TEXT,
                severity_floor TEXT CHECK(severity_floor IS NULL OR severity_floor IN ('info','suggestion','warning','critical')),
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, scope, scope_target, preset_key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_review_prompts_lookup ON ai_review_prompts(scope, scope_target, is_default)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_review_prompts_user ON ai_review_prompts(user_id)`);

        // PR-context AI slash commands (slice 3): /describe, /test_plan, /improve
        // Stores last result per (user, repo, PR#, command) for cache + UI review.
        db.exec(`
            CREATE TABLE IF NOT EXISTS ai_pr_commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                command TEXT NOT NULL CHECK(command IN ('describe','test_plan','improve')),
                last_head_sha TEXT NOT NULL,
                result_json TEXT NOT NULL,
                cost_usd REAL,
                model_used TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, repo_owner, repo_name, pr_number, command),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_pr_commands_lookup ON ai_pr_commands(repo_owner, repo_name, pr_number)`);

        // PR-context AI chat (slice 2): conversation history per (user, PR)
        db.exec(`
            CREATE TABLE IF NOT EXISTS ai_pr_chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
                content TEXT NOT NULL,
                tool_name TEXT,
                tool_input_json TEXT,
                tool_output_json TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                model_used TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_pr_chat_lookup ON ai_pr_chat_messages(user_id, repo_owner, repo_name, pr_number, id)`);

        // -----------------------------------------------------------------------
        // Work Board — Premium UX Feature Tables
        // -----------------------------------------------------------------------

        db.exec(`
            CREATE TABLE IF NOT EXISTS work_board_tracked_repos (
                user_id              INTEGER NOT NULL,
                repo_full_name       TEXT NOT NULL,
                repo_id              INTEGER,
                source_signal        TEXT NOT NULL,
                is_pinned            INTEGER NOT NULL DEFAULT 0,
                is_muted             INTEGER NOT NULL DEFAULT 0,
                last_activity_at     DATETIME,
                discovered_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_synced_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, repo_full_name),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_wbtr_user_active
                ON work_board_tracked_repos(user_id, is_muted, last_activity_at DESC);

            CREATE TABLE IF NOT EXISTS work_board_prefs (
                user_id                 INTEGER PRIMARY KEY,
                discovery_window_days   INTEGER NOT NULL DEFAULT 60,
                max_auto_repos          INTEGER NOT NULL DEFAULT 50,
                auto_mute_bots          INTEGER NOT NULL DEFAULT 0,
                ai_assistant_enabled    INTEGER NOT NULL DEFAULT 0,
                ai_monthly_cap_cents    INTEGER NOT NULL DEFAULT 500,
                ai_response_locale      TEXT,
                last_discovery_at       DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS work_board_ai_dismissed (
                user_id        INTEGER NOT NULL,
                pattern_key    TEXT NOT NULL,
                repo_full_name TEXT NOT NULL DEFAULT '',
                dismissed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, pattern_key, repo_full_name),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS work_board_undo_log (
                operation_id     TEXT PRIMARY KEY,
                user_id          INTEGER NOT NULL,
                operation_type   TEXT NOT NULL,
                before_state     TEXT NOT NULL,
                after_state      TEXT NOT NULL,
                created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at       DATETIME NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_undo_user_expires
                ON work_board_undo_log(user_id, expires_at);

            CREATE TABLE IF NOT EXISTS work_board_ai_spend (
                user_id  INTEGER NOT NULL,
                month    TEXT NOT NULL,
                cents    INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, month),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_wbai_spend_user_month
                ON work_board_ai_spend(user_id, month);

            -- Generalized per-user monthly AI spend (denial-of-wallet cap across
            -- the whole AI surface; see server/lib/ai-spend-cap.js). Separate
            -- from work_board_ai_spend so the Work Board's own cap is unaffected.
            CREATE TABLE IF NOT EXISTS ai_spend (
                user_id  INTEGER NOT NULL,
                month    TEXT NOT NULL,
                cents    INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, month),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_ai_spend_user_month
                ON ai_spend(user_id, month);
        `);

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
        // Dashboard inbox hot path (listMyOpenPRs filters by author_login + action).
        // Without this composite index every inbox load full-scans pr_events.
        db.exec(`CREATE INDEX IF NOT EXISTS idx_pr_events_author_action ON pr_events(author_login, action)`);

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
        // GDPR delete + dashboard "mentions" path filter by author_login.
        db.exec(`CREATE INDEX IF NOT EXISTS idx_issue_events_author ON issue_events(author_login)`);

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

    // Versioned schema migrations (post-base-schema). Idempotent + recorded
    // in schema_migrations; safe on the existing DB. See lib/db-migrations.js.
    runMigrations(db);

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
