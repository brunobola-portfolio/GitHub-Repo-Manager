// Schema migration framework for the SQLite store.
//
// initDB() applies the idempotent base schema (CREATE TABLE/INDEX IF NOT EXISTS),
// then calls runMigrations(db) to apply the ordered, versioned changes below.
//
// Design notes:
//   - A schema_migrations(version, name, applied_at) ledger records which
//     migrations have run, giving the version tracking the hand-numbered
//     try/catch blocks never had.
//   - Every up(db) is INTENTIONALLY idempotent (CREATE ... IF NOT EXISTS +
//     addColumnIfMissing), so on a database that predates the ledger (e.g. the
//     existing production DB) the runner can re-apply every migration as a safe
//     no-op and then backfill the ledger. Idempotency — not the ledger — is the
//     safety guarantee; the ledger is just a fast-skip + audit trail.
//   - addColumnIfMissing replaces the previous
//     `try { ALTER ... } catch (e) { if (!e.message.includes('duplicate column')) throw }`
//     idiom, which depended on a brittle driver/locale-specific error string.

/**
 * Add a column to a table only if it isn't already present (PRAGMA table_info).
 * Idempotent + driver-string-independent. Returns true if it added the column.
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @param {string} column
 * @param {string} definition - e.g. "TEXT", "INTEGER NOT NULL DEFAULT 0"
 */
export function addColumnIfMissing(db, table, column, definition) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (cols.some((c) => c.name === column)) return false;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
}

// Ordered migrations applied after the base schema. version is unique + the sort
// key; the base schema is the implicit v1 baseline (always applied first).
export const MIGRATIONS = [
    {
        version: 2,
        name: 'migration_jobs.is_mirror + index',
        up(db) {
            addColumnIfMissing(db, 'migration_jobs', 'is_mirror', 'INTEGER DEFAULT 0');
            db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_jobs_mirror
                     ON migration_jobs(target_owner, target_repo, is_mirror)`);
        },
    },
    {
        version: 3,
        name: 'api_keys.last_used_ip/ua',
        up(db) {
            addColumnIfMissing(db, 'api_keys', 'last_used_ip', 'TEXT');
            addColumnIfMissing(db, 'api_keys', 'last_used_ua', 'TEXT');
        },
    },
    {
        version: 4,
        name: 'user_ai_config.feature_overrides_json',
        up(db) {
            addColumnIfMissing(db, 'user_ai_config', 'feature_overrides_json', 'TEXT');
        },
    },
    {
        version: 5,
        name: 'audit_log_v2 hash chain + append-only triggers',
        up(db) {
            addColumnIfMissing(db, 'audit_log_v2', 'prev_hash', "TEXT NOT NULL DEFAULT ''");
            addColumnIfMissing(db, 'audit_log_v2', 'row_hash', "TEXT NOT NULL DEFAULT ''");
            // Append-only triggers — reject every UPDATE/DELETE. auditLog() only
            // ever INSERTs, so these never fire in normal operation.
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
        },
    },
    {
        version: 6,
        name: 'users.deleted_at (GDPR tombstone)',
        up(db) {
            addColumnIfMissing(db, 'users', 'deleted_at', 'TEXT');
        },
    },
    {
        version: 7,
        name: 'issued_licenses',
        up(db) {
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
        },
    },
    {
        version: 8,
        name: 'user_ai_config.warning_sent_at',
        up(db) {
            addColumnIfMissing(db, 'user_ai_config', 'warning_sent_at', 'DATETIME');
        },
    },
    {
        version: 9,
        name: 'issue_events.title',
        up(db) {
            addColumnIfMissing(db, 'issue_events', 'title', 'TEXT');
        },
    },
    {
        version: 10,
        name: 'work_board_cache',
        up(db) {
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
        },
    },
    {
        version: 11,
        name: 'work_board_snooze',
        up(db) {
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
        },
    },
    {
        version: 12,
        name: 'work_board_presets',
        up(db) {
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
        },
    },
    {
        version: 13,
        name: 'email_dead_letter',
        up(db) {
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
        },
    },
    {
        version: 14,
        name: 'webhook_events_dead_letter',
        up(db) {
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
        },
    },
    {
        version: 15,
        name: 'composite indexes on hot query paths',
        up(db) {
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
        },
    },
    {
        version: 16,
        name: 'users.is_admin',
        up(db) {
            addColumnIfMissing(db, 'users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
        },
    },
    {
        version: 17,
        name: 'work_board_kpi_snapshots',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS work_board_kpi_snapshots (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id     INTEGER NOT NULL,
                    snapped_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    reviews     INTEGER NOT NULL DEFAULT 0,
                    stale_prs   INTEGER NOT NULL DEFAULT 0,
                    issues      INTEGER NOT NULL DEFAULT 0,
                    tech_debt   INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_wbks_user_time
                     ON work_board_kpi_snapshots(user_id, snapped_at DESC)`);
        },
    },
    {
        version: 18,
        name: 'users.notifications_last_seen_at',
        up(db) {
            addColumnIfMissing(db, 'users', 'notifications_last_seen_at', 'TEXT');
        },
    },
    {
        version: 19,
        name: 'gh_cache',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS gh_cache (
                    user_id        INTEGER NOT NULL,
                    resource_type  TEXT    NOT NULL,
                    resource_key   TEXT    NOT NULL,
                    payload        TEXT    NOT NULL,
                    etag           TEXT,
                    fetched_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    stale_at       DATETIME NOT NULL,
                    PRIMARY KEY (user_id, resource_type, resource_key),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_gh_cache_resource_type
                     ON gh_cache(resource_type, resource_key)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_gh_cache_fetched_at
                     ON gh_cache(fetched_at)`);
        },
    },
    {
        version: 20,
        name: 'gh_outbox',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS gh_outbox (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id          INTEGER NOT NULL,
                    method           TEXT    NOT NULL,
                    url              TEXT    NOT NULL,
                    body             TEXT,
                    idempotency_key  TEXT    NOT NULL UNIQUE,
                    status           TEXT    NOT NULL DEFAULT 'pending',
                    attempts         INTEGER NOT NULL DEFAULT 0,
                    last_error       TEXT,
                    response_status  INTEGER,
                    response_body    TEXT,
                    next_retry_at    DATETIME,
                    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    completed_at     DATETIME,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_gh_outbox_user_status
                     ON gh_outbox(user_id, status)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_gh_outbox_pending_retry
                     ON gh_outbox(status, next_retry_at)
                     WHERE status = 'pending'`);
        },
    },
    {
        version: 21,
        name: 'installed_license (singleton)',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS installed_license (
                    id            INTEGER PRIMARY KEY CHECK (id = 1),
                    license_key   TEXT    NOT NULL,
                    tier          TEXT    NOT NULL,
                    org           TEXT,
                    email         TEXT,
                    seats         INTEGER,
                    issued_at     DATETIME,
                    expires_at    DATETIME,
                    installed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    installed_by  INTEGER,
                    FOREIGN KEY (installed_by) REFERENCES users(id) ON DELETE SET NULL
                )
            `);
        },
    },
    {
        version: 22,
        name: 'dashboard_inbox_state',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS dashboard_inbox_state (
                    user_id        INTEGER NOT NULL,
                    item_id        TEXT    NOT NULL,
                    archived_at    TEXT,
                    snoozed_until  TEXT,
                    PRIMARY KEY (user_id, item_id)
                )
            `);
        },
    },
    {
        version: 23,
        name: 'TFS host columns on migration_jobs/plans + quota_charged + index',
        up(db) {
            addColumnIfMissing(db, 'migration_jobs', 'source_host', 'TEXT');
            addColumnIfMissing(db, 'migration_plans', 'azure_host', 'TEXT');
            addColumnIfMissing(db, 'migration_plans', 'tagging_policy', 'TEXT');
            addColumnIfMissing(db, 'migration_plans', 'quota_charged', 'INTEGER NOT NULL DEFAULT 0');
            db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_jobs_host
                     ON migration_jobs(source_host, source_url)`);
        },
    },
    {
        version: 24,
        name: 'azure_host_allowlist',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS azure_host_allowlist (
                    pattern    TEXT PRIMARY KEY,
                    added_by   INTEGER,
                    added_at   TEXT NOT NULL DEFAULT (datetime('now')),
                    notes      TEXT,
                    FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
                )
            `);
        },
    },
    {
        version: 25,
        name: 'user_azure_credentials',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS user_azure_credentials (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id         INTEGER NOT NULL,
                    label           TEXT NOT NULL,
                    host            TEXT NOT NULL,
                    org             TEXT,
                    pat_encrypted   TEXT NOT NULL,
                    pat_prefix      TEXT,
                    scopes          TEXT,
                    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                    last_used_at    TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_user_azure_creds_user_host
                     ON user_azure_credentials(user_id, host)`);
        },
    },
    {
        version: 26,
        name: 'event tables: action-leading indexes for dashboard/work-board fallbacks',
        up(db) {
            // listMyOpenIssues / listTechDebtIssues (event-aggregations.js) and
            // listStalePRs (dashboard-aggregator.js) filter by action='opened' |
            // 'closed'. No existing index leads with `action`, so those queries —
            // some run unscoped per active user by the KPI snapshot job — full-scan
            // the multi-tenant event tables. A leading-action index (with created_at
            // for the recency window / ORDER BY) makes the predicate index-driven.
            db.exec(`CREATE INDEX IF NOT EXISTS idx_issue_events_action_created
                     ON issue_events(action, created_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_pr_events_action_created
                     ON pr_events(action, created_at)`);
        },
    },
    {
        version: 27,
        name: "migration_jobs.status: unify legacy 'complete' → 'completed'",
        up(db) {
            // The legacy import pipeline (url/azure-git/azure-tfvc) historically
            // wrote status='complete' while the bulk-mirror path and the new
            // migration engine write 'completed'. That split made bulk-mirrored
            // jobs render 'Pending' forever and undercounted the dashboard's
            // Successful stat. Writers are now canonicalized to 'completed';
            // fold existing rows over so history + stats agree. Idempotent —
            // a re-run finds no 'complete' rows left to update.
            db.exec(`UPDATE migration_jobs SET status = 'completed' WHERE status = 'complete'`);
        },
    },
    {
        version: 28,
        name: 'drop dead tables: audit_log (v1) + license_keys',
        up(db) {
            // audit_log (v1) was superseded by audit_log_v2 (hash-chained,
            // append-only) — lib/audit.js only ever writes v2. license_keys was
            // superseded by issued_licenses (lib/license-issuer.js) plus the
            // installed_license singleton. Neither dead table had any production
            // reader or writer, so dropping them keeps the schema, the GDPR
            // erasure registry, and the audit trail honest. Idempotent: a no-op
            // on a fresh DB where the base schema no longer creates them, and on
            // a re-run after the tables are already gone.
            db.exec(`DROP TABLE IF EXISTS audit_log`);
            db.exec(`DROP TABLE IF EXISTS license_keys`);
        },
    },
    {
        version: 29,
        name: 'user_subscriptions.billing_period',
        up(db) {
            // Populated from the checkout session's billingPeriod metadata
            // (routes/billing.js) at checkout.session.completed. Read back at
            // invoice.paid to decide whether a subscription is due a fresh
            // 1-month license key on renewal (monthly subs) or not (yearly subs
            // already hold a 12-month key) — see stripe-webhooks.js and
            // docs/billing-and-licensing.md. Defaults 'monthly' so rows written
            // before this migration (all monthly-billed historically, since
            // yearly checkout only recently shipped) don't need a backfill.
            addColumnIfMissing(db, 'user_subscriptions', 'billing_period', "TEXT NOT NULL DEFAULT 'monthly'");
        },
    },
    {
        version: 30,
        name: 'event tables: timestamp-leading indexes for the retention purge',
        up(db) {
            // purgeOldEvents (maintenance-janitors.js) deletes in LIMIT-ed batches
            // filtered ONLY by the row's own creation timestamp. Every pre-existing
            // index on these tables leads with repo_id / action / author_login /
            // reviewer_login, so the planner had no choice but to full-scan the
            // table from row 1 for EVERY batch — quadratic work that stalls the
            // boot-time maintenance pass for minutes once a year of events has
            // been ingested. A timestamp-leading index turns each batch into a
            // range seek that stops at the retention cutoff.
            db.exec(`CREATE INDEX IF NOT EXISTS idx_pr_events_created
                     ON pr_events(created_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_issue_events_created
                     ON issue_events(created_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_deployment_events_created
                     ON deployment_events(created_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_review_assignments_requested
                     ON review_assignments(requested_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_created
                     ON workflow_runs(created_at)`);
        },
    },
    {
        version: 31,
        name: 'gh_cache: NOCASE resource_key index for prefix invalidation',
        up(db) {
            // gh-cache.invalidateByRepo() matches `resource_key LIKE 'owner/repo%'`
            // and runs 2-4x per webhook delivery. SQLite only rewrites a prefix
            // LIKE into an index range scan when the indexed column's collation
            // matches LIKE's comparison — and LIKE is case-insensitive unless
            // PRAGMA case_sensitive_like is on, which it is not here. The BINARY
            // index created alongside the table therefore never applied and each
            // call full-scanned gh_cache. Rebuilding it NOCASE makes the same
            // query index-seekable without changing which rows match.
            db.exec(`DROP INDEX IF EXISTS idx_gh_cache_resource_type`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_gh_cache_resource_type
                     ON gh_cache(resource_type, resource_key COLLATE NOCASE)`);
        },
    },
    {
        version: 32,
        name: 'revoked_licenses (license kill switch)',
        up(db) {
            // Every signed license JWT carries a `lid` claim that nothing ever
            // consulted, so a leaked key — or a refunded customer's emailed key,
            // which the Stripe downgrade does not touch — stayed valid until its
            // `exp`. This table is the kill switch: verifyLicenseKey() (in
            // lib/license.js) fails closed on any `lid` listed here.
            //
            // Keyed on `lid`, not on the raw key, so an operator can revoke from
            // the id alone — no need to hold the secret-bearing key to kill it,
            // and the row stays harmless if the DB is read by someone else.
            // `expires_at` is copied from the payload when known so a janitor can
            // one day prune rows whose key is dead on its own terms.
            db.exec(`
                CREATE TABLE IF NOT EXISTS revoked_licenses (
                    lid         TEXT PRIMARY KEY,
                    reason      TEXT NOT NULL,
                    revoked_at  TEXT NOT NULL DEFAULT (datetime('now')),
                    revoked_by  INTEGER,
                    org         TEXT,
                    tier        TEXT,
                    expires_at  TEXT,
                    FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_revoked_licenses_revoked_at
                     ON revoked_licenses(revoked_at DESC)`);
        },
    },
    {
        version: 33,
        name: 'ai_spend: micro-cent column so sub-cent calls accumulate',
        up(db) {
            // recordAISpend rounded every call to whole cents and dropped
            // anything that rounded to 0. A 2k-in/500-out call on a flash-class
            // model costs ~$0.0004 — recorded as 0. Thousands of them summed to
            // a recorded spend of zero, so the denial-of-wallet cap could never
            // fire no matter how much the operator's key was actually billed.
            //
            // micro_cents holds 1/10,000 of a cent, which keeps every realistic
            // per-call cost as an exact integer and cannot drift the way a REAL
            // column would. The legacy `cents` column is preserved untouched as
            // a baseline and simply added to the derived total, so historical
            // spend survives and nothing is double-counted.
            const cols = db.prepare('PRAGMA table_info(ai_spend)').all();
            if (!cols.some((c) => c.name === 'micro_cents')) {
                db.exec('ALTER TABLE ai_spend ADD COLUMN micro_cents INTEGER NOT NULL DEFAULT 0');
            }
        },
    },
    {
        version: 34,
        name: 'deployment_events: (deployment_id, environment, id DESC) for the DORA rollups',
        up(db) {
            // event-aggregations.js resolves each deployment's latest status
            // with a correlated `MAX(id)` subquery keyed on deployment_id.
            // deployment_id carried no index at all, so that subquery
            // full-scanned the table once per candidate row — O(rows²) inside
            // one synchronous .all(), on every dashboard and Work Board DORA
            // load. Leading with deployment_id makes the correlation a seek;
            // environment and `id DESC` are carried so the environment filter
            // and the MAX(id) are both answered from the index.
            db.exec(`CREATE INDEX IF NOT EXISTS idx_deployment_events_dep_env
                     ON deployment_events(deployment_id, environment, id DESC)`);
        },
    },
    {
        version: 35,
        name: 'work_board_presets: scope column for saved views beyond Work Board (G5)',
        up(db) {
            // Generalises "Work Board presets" into tenant-scoped "saved views" —
            // the Repositories filter bar wants the same save/apply UX. SQLite
            // can't ALTER a UNIQUE constraint in place, so this rebuilds the
            // table (standard 12-step recipe) to widen UNIQUE(user_id, name) to
            // UNIQUE(user_id, scope, name): without that widening, a user with a
            // Work Board preset named "My review queue" could never save a
            // Repositories view with the same name. Idempotent: skips the
            // rebuild if `scope` already exists (re-run on an already-migrated
            // DB, or a fixture that pre-seeds the new shape).
            //
            // No FK toggling needed: this codebase never turns PRAGMA
            // foreign_keys on (server/db.js), and no other table references
            // work_board_presets as a parent, so recreating it is safe as-is.
            const cols = db.prepare('PRAGMA table_info(work_board_presets)').all();
            if (cols.some((c) => c.name === 'scope')) return;

            db.exec(`
                CREATE TABLE work_board_presets_new (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id    INTEGER NOT NULL,
                    scope      TEXT    NOT NULL DEFAULT 'work-board',
                    name       TEXT    NOT NULL,
                    filters    TEXT    NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (user_id, scope, name),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);
            db.exec(`
                INSERT INTO work_board_presets_new (id, user_id, scope, name, filters, created_at, updated_at)
                SELECT id, user_id, 'work-board', name, filters, created_at, updated_at FROM work_board_presets
            `);
            db.exec('DROP TABLE work_board_presets');
            db.exec('ALTER TABLE work_board_presets_new RENAME TO work_board_presets');
            db.exec('CREATE INDEX IF NOT EXISTS idx_wbp_user ON work_board_presets(user_id)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_wbp_user_scope ON work_board_presets(user_id, scope)');
        },
    },
    {
        version: 36,
        name: 'users.digest_frequency + digest_last_sent_at (G7)',
        up(db) {
            // Per-user opt-in for the scheduled digest e-mail (server/lib/
            // digest-mailer.js + maintenance-janitors.js's digest job).
            // Default 'off' — this is opt-in, never opt-out; existing users
            // get no new e-mail until they explicitly turn it on in Settings.
            addColumnIfMissing(db, 'users', 'digest_frequency', "TEXT NOT NULL DEFAULT 'off'");
            // NULL until the first digest is actually sent; the job treats
            // NULL as "due" so a freshly opted-in user gets one on the next
            // pass rather than waiting a full period.
            addColumnIfMissing(db, 'users', 'digest_last_sent_at', 'TEXT');
        },
    },
    {
        version: 37,
        name: 'work_board_health_snapshots: portfolio health scorecard history (G9)',
        up(db) {
            // Append-only history of community-health scores per (user, repo),
            // distinct from `community_health_cache` (which only ever holds the
            // LATEST score, overwritten on every re-check via its ON CONFLICT
            // UPDATE). The Work Board's Health tab needs a week-over-week delta,
            // which requires at least two points in time — hence a separate,
            // insert-only table rather than reusing the cache.
            //
            // Written by two producers: the on-demand health check route
            // (server/routes/work-board.js's GET /health) and the periodic KPI
            // snapshot job (server/lib/maintenance-janitors.js), which skips a
            // repo already captured in the last 24h so the two producers don't
            // duplicate rows on a normal day.
            db.exec(`
                CREATE TABLE IF NOT EXISTS work_board_health_snapshots (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id         INTEGER NOT NULL,
                    repo_full_name  TEXT NOT NULL,
                    score           INTEGER NOT NULL,
                    failing_checks  TEXT NOT NULL DEFAULT '[]',
                    captured_at     TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_wbhs_user_repo_time ON work_board_health_snapshots(user_id, repo_full_name, captured_at)');
        },
    },
];

// The highest version this build of the app knows how to apply. Used to
// detect a DB ledger written by a newer build (e.g. after a rollback to an
// older installer) so runMigrations() can refuse to touch it instead of
// silently treating unrecognized future rows as "nothing to do".
export const APP_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

// Thrown by runMigrations() when the schema_migrations ledger's highest
// recorded version is newer than APP_SCHEMA_VERSION — i.e. this DB was last
// written by a newer app build than the one currently running. Applying
// migrations in that state would be guessing at a schema this build has
// never seen, so boot must stop before anything is touched.
export class DBSchemaFromFutureError extends Error {
    constructor(dbVersion, appVersion) {
        super(
            `This database was created by a NEWER version of GitHub Repo Manager ` +
            `(schema v${dbVersion}; this app knows up to v${appVersion}). Refusing to start ` +
            `to protect your data. Reinstall the newer version, or restore the pre-update ` +
            `snapshot from the data directory's updates folder.`,
        );
        this.name = 'DBSchemaFromFutureError';
        this.dbVersion = dbVersion;
        this.appVersion = appVersion;
    }
}

/**
 * Apply all not-yet-recorded migrations in version order, recording each in the
 * schema_migrations ledger. Safe to run on every boot and on databases that
 * predate the ledger (every up() is idempotent).
 * @param {import('better-sqlite3').Database} db
 * @throws {DBSchemaFromFutureError} if the ledger's newest version is beyond
 *   what this build knows — checked before any migration is applied.
 */
export function runMigrations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    const dbVersion = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    if (dbVersion !== null && dbVersion > APP_SCHEMA_VERSION) {
        throw new DBSchemaFromFutureError(dbVersion, APP_SCHEMA_VERSION);
    }
    const applied = new Set(
        db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
    );
    const ordered = [...MIGRATIONS].sort((a, b) => a.version - b.version);
    for (const m of ordered) {
        if (applied.has(m.version)) continue;
        const apply = db.transaction(() => {
            m.up(db);
            db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
        });
        apply();
    }
}
