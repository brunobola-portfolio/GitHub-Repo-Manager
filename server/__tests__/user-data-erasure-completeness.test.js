// @vitest-environment node
/**
 * GDPR erasure — structural completeness (Article 17 / SOC 2 CC6.5)
 *
 * These tests are the guardrail that prevents the historical bug (a newly-added
 * user-scoped table silently surviving "Erase my data") from ever recurring:
 *
 *  1. scanSchemaForUnclassifiedUserTables — introspects the REAL initDB schema
 *     (sqlite_master + PRAGMA table_info) and fails if any table carrying a
 *     user-keyed column is not classified in ERASURE_REGISTRY.
 *  2. verifyRegistryConsistency — the opposite drift: every registry entry must
 *     point at a table + key column that still exist.
 *  3. End-to-end wipe — seed one row in every erase/cascade/survive table and
 *     assert the DELETE route empties all user-owned rows, keeps the survive
 *     rows, and tombstones the users row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Ensure db.js opens a throw-away in-memory adapter (never the real data file)
// when its real module is loaded via importOriginal below. Must run before any
// import resolves ../db.js — vi.hoisted is hoisted above the imports.
vi.hoisted(() => {
    process.env.DATABASE_URL = 'sqlite::memory:';
});

import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// db.js mock: keep the REAL named exports (initDB etc.), swap only the default
// singleton for a per-test in-memory Proxy the router reads through.
// ---------------------------------------------------------------------------

let _db;

vi.mock('../db.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        default: new Proxy({}, { get(_t, prop) { return _db[prop]; } }),
    };
});

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn() },
}));

import { initDB } from '../db.js';
import userDataRouter, {
    ERASURE_REGISTRY,
    scanSchemaForUnclassifiedUserTables,
    verifyRegistryConsistency,
} from '../routes/user-data.js';
import { _resetAuditStatementCache } from '../lib/audit.js';

// ---------------------------------------------------------------------------
// Full-schema in-memory DB (base schema + every migration, exactly like prod)
// ---------------------------------------------------------------------------

function buildFullDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initDB(db);
    return db;
}

function buildApp(sessionUserId = 42) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = {
            userId: sessionUserId,
            accessToken: 'stub-token',
            destroy: (cb) => { if (cb) cb(); },
        };
        next();
    });
    app.use('/api/v1/user/data', userDataRouter);
    return app;
}

beforeEach(() => {
    _db = buildFullDb();
    _resetAuditStatementCache();
});

afterEach(() => {
    _db?.close();
});

// ---------------------------------------------------------------------------
// 1 + 2 — Registry ⇄ schema completeness
// ---------------------------------------------------------------------------

describe('erasure registry completeness', () => {
    it('scans the REAL production schema (initDB), not an empty/fixture db', () => {
        // Guards against the scan trivially "passing" because _db has no
        // tables (e.g. initDB silently no-op'd, or a future refactor swaps
        // in a fixture db here) — an empty schema always reports zero
        // unclassified tables, which would defeat this whole guardrail.
        // `_db` is built by buildFullDb() -> initDB(db), where initDB is the
        // *actual* server/db.js export (imported above before the module
        // mock swaps only the `default` singleton) — the same function that
        // creates the production schema. Threshold set comfortably below the
        // current table count so routine schema growth doesn't rot this test.
        const tableCount = _db
            .prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
            .get().c;
        expect(tableCount).toBeGreaterThanOrEqual(30);
    });

    it('classifies every table that carries a user-keyed column', () => {
        const unclassified = scanSchemaForUnclassifiedUserTables(_db);
        expect(
            unclassified,
            `Unclassified user-scoped tables — add them to ERASURE_REGISTRY: ${JSON.stringify(unclassified)}`,
        ).toEqual([]);
    });

    it('every registry entry points at an existing table + key column', () => {
        const problems = verifyRegistryConsistency(_db);
        expect(problems, problems.join('; ')).toEqual([]);
    });

    it('marks the append-only audit table as survive (never erased)', () => {
        const byTable = Object.fromEntries(ERASURE_REGISTRY.map((e) => [e.table, e]));
        expect(byTable['audit_log_v2'].action).toBe('survive');
        // Legacy v1 audit_log was dropped (db-migrations.js migration 28); only v2 remains.
        expect(byTable['audit_log']).toBeUndefined();
        expect(byTable['users'].action).toBe('tombstone');
    });
});

// ---------------------------------------------------------------------------
// 3 — End-to-end wipe against the full schema
// ---------------------------------------------------------------------------

describe('erasure wipes every user-scoped table', () => {
    const USER_ID = 42;
    const LOGIN = 'alice';
    const EMAIL = 'alice@example.com';

    function seedEverything() {
        const run = (sql, ...p) => _db.prepare(sql).run(...p);

        // Parent rows first (FK order).
        run(`INSERT INTO users (id, username, email) VALUES (?, ?, ?)`, USER_ID, LOGIN, EMAIL);
        const teamId = _db.prepare(`INSERT INTO teams (name, owner_id) VALUES ('t', ?)`).run(USER_ID).lastInsertRowid;
        const planId = _db.prepare(
            `INSERT INTO migration_plans (user_id, source_org, source_project) VALUES (?, 'org', 'proj')`,
        ).run(USER_ID).lastInsertRowid;

        // Erase — user_id keyed
        run(`INSERT INTO user_ai_config (user_id, completion_provider, completion_credentials_enc) VALUES (?, 'openai', 'SECRET')`, USER_ID);
        run(`INSERT INTO user_ai_prompts (user_id, feature_key, prompt) VALUES (?, 'summary', 'p')`, USER_ID);
        run(`INSERT INTO ai_pr_reviews (user_id, repo_owner, repo_name, pr_number, last_reviewed_sha, draft_json) VALUES (?, 'o', 'r', 1, 'sha', '{}')`, USER_ID);
        run(`INSERT INTO ai_review_prompts (user_id, scope, preset_key, name, system_prompt) VALUES (?, 'user', 'k', 'n', 'sp')`, USER_ID);
        run(`INSERT INTO ai_pr_commands (user_id, repo_owner, repo_name, pr_number, command, last_head_sha, result_json) VALUES (?, 'o', 'r', 1, 'describe', 'sha', '{}')`, USER_ID);
        run(`INSERT INTO ai_pr_chat_messages (user_id, repo_owner, repo_name, pr_number, role, content) VALUES (?, 'o', 'r', 1, 'user', 'private transcript')`, USER_ID);
        run(`INSERT INTO user_azure_credentials (user_id, label, host, pat_encrypted) VALUES (?, 'l', 'dev.azure.com', 'ENCRYPTED_PAT')`, USER_ID);
        run(`INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo) VALUES (?, 'github', 'http://x', 'x', 'o', 'r')`, USER_ID);
        run(`INSERT INTO community_health_cache (repo_id, user_id, health_score, metrics, recommendations) VALUES (1, ?, 50, '{}', '[]')`, USER_ID);
        run(`INSERT INTO repo_metadata (repo_id, user_id, summary) VALUES (1, ?, 's')`, USER_ID);
        run(`INSERT INTO repo_embeddings (repo_id, user_id, embedding) VALUES (1, ?, '[]')`, USER_ID);
        run(`INSERT INTO workflow_runs (github_run_id, repo_id, user_id, workflow_id, workflow_name, run_number, status, started_at) VALUES (1, 1, ?, 1, 'wf', 1, 'completed', '2026-01-01')`, USER_ID);
        run(`INSERT INTO workflows_meta (repo_id, user_id, github_workflow_id, name) VALUES (1, ?, 1, 'wf')`, USER_ID);
        run(`INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end) VALUES (?, 'api', 1, '2026-01', '2026-02')`, USER_ID);
        run(`INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix) VALUES ('k1', ?, 'key', 'hash', 'grm_')`, USER_ID);
        run(`INSERT INTO user_subscriptions (user_id, status) VALUES (?, 'cancelled')`, USER_ID);
        run(`INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')`, teamId, USER_ID);
        run(`INSERT INTO repo_assignments (team_id, repo_full_name, repo_id, assigned_by) VALUES (?, 'o/r', 1, ?)`, teamId, USER_ID);
        run(`INSERT INTO dashboard_inbox_state (user_id, item_id) VALUES (?, 'pr:o/r#1')`, USER_ID);
        run(`INSERT INTO issued_licenses (user_id, tier, license_key) VALUES (?, 'pro', 'key')`, USER_ID);
        run(`INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal) VALUES (?, 'o/r', 'manual')`, USER_ID);
        run(`INSERT INTO work_board_prefs (user_id) VALUES (?)`, USER_ID);
        run(`INSERT INTO work_board_ai_dismissed (user_id, pattern_key) VALUES (?, 'p')`, USER_ID);
        run(`INSERT INTO work_board_undo_log (operation_id, user_id, operation_type, before_state, after_state, expires_at) VALUES ('op1', ?, 'mute', '{}', '{}', datetime('now', '+1 day'))`, USER_ID);
        run(`INSERT INTO work_board_ai_spend (user_id, month) VALUES (?, '2026-07')`, USER_ID);
        run(`INSERT INTO ai_spend (user_id, month) VALUES (?, '2026-07')`, USER_ID);
        run(`INSERT INTO work_board_cache (user_id, query_type, payload, expires_at) VALUES (?, 'inbox', '{}', datetime('now', '+1 hour'))`, USER_ID);
        run(`INSERT INTO work_board_snooze (user_id, repo_full_name, item_type, item_number, until_at) VALUES (?, 'o/r', 'pr', 1, datetime('now', '+1 day'))`, USER_ID);
        run(`INSERT INTO work_board_presets (user_id, name, filters) VALUES (?, 'n', '{}')`, USER_ID);
        run(`INSERT INTO work_board_kpi_snapshots (user_id) VALUES (?)`, USER_ID);
        run(`INSERT INTO gh_cache (user_id, resource_type, resource_key, payload, stale_at) VALUES (?, 'repo', 'k', '{}', datetime('now', '+1 hour'))`, USER_ID);
        run(`INSERT INTO gh_outbox (user_id, method, url, body, idempotency_key) VALUES (?, 'POST', 'http://x', 'REQUEST_BODY', 'idem1')`, USER_ID);

        // Erase — login keyed
        run(`INSERT INTO pr_events (repo_id, repo_full_name, pr_number, action, author_login) VALUES (1, 'o/r', 1, 'opened', ?)`, LOGIN);
        run(`INSERT INTO issue_events (repo_id, repo_full_name, issue_number, action, author_login) VALUES (1, 'o/r', 1, 'opened', ?)`, LOGIN);
        run(`INSERT INTO review_assignments (repo_id, repo_full_name, pr_number, reviewer_login) VALUES (1, 'o/r', 1, ?)`, LOGIN);

        // Erase — email keyed
        run(`INSERT INTO email_dead_letter (to_address, subject) VALUES (?, 'sub')`, EMAIL);

        // Cascade — via migration_plans
        run(`INSERT INTO migration_tasks (plan_id, type, source_ref) VALUES (?, 'repo', 'src')`, planId);
        run(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload) VALUES (?, 'source', 'repo', 'tid', '{}')`, planId);

        // Survive
        run(`INSERT INTO audit_log_v2 (user_id, action, resource_type) VALUES (?, 'seed', 'user')`, USER_ID);
        run(`INSERT INTO azure_host_allowlist (pattern, added_by) VALUES ('*.azure.com', ?)`, USER_ID);
        run(`INSERT INTO installed_license (id, license_key, tier, installed_by) VALUES (1, 'k', 'pro', ?)`, USER_ID);

        return { teamId, planId };
    }

    it('empties every erase/cascade table, keeps survive rows, tombstones the user', async () => {
        seedEverything();
        const app = buildApp(USER_ID);

        const res = await request(app)
            .delete('/api/v1/user/data')
            .send({ confirmString: 'ERASE MY DATA' });

        expect(res.status).toBe(200);

        // The previously-missed high-risk tables report a real deletion.
        expect(res.body.deleted.user_azure_credentials).toBe(1);
        expect(res.body.deleted.ai_pr_chat_messages).toBe(1);
        expect(res.body.deleted.gh_outbox).toBe(1);
        expect(res.body.deleted.gh_cache).toBe(1);
        expect(res.body.deleted.ai_spend).toBe(1);
        expect(res.body.deleted.email_dead_letter).toBe(1);

        // Every 'erase' table must now be empty for this data subject.
        const values = { userId: USER_ID, login: LOGIN, email: EMAIL };
        for (const entry of ERASURE_REGISTRY.filter((e) => e.action === 'erase')) {
            const v = values[entry.key.source];
            const { c } = _db.prepare(`SELECT COUNT(*) c FROM ${entry.table} WHERE ${entry.key.column} = ?`).get(v);
            expect(c, `${entry.table} still holds user rows after erasure`).toBe(0);
        }

        // Cascade tables emptied via the migration_plans delete.
        expect(_db.prepare(`SELECT COUNT(*) c FROM migration_tasks`).get().c).toBe(0);
        expect(_db.prepare(`SELECT COUNT(*) c FROM migration_marks`).get().c).toBe(0);

        // Survive tables retained.
        expect(_db.prepare(`SELECT COUNT(*) c FROM teams WHERE owner_id = ?`).get(USER_ID).c).toBe(1);
        expect(_db.prepare(`SELECT COUNT(*) c FROM azure_host_allowlist`).get().c).toBe(1);
        expect(_db.prepare(`SELECT COUNT(*) c FROM installed_license`).get().c).toBe(1);
        // audit_log_v2: the seed row + the user.erased row, both retained.
        expect(_db.prepare(`SELECT COUNT(*) c FROM audit_log_v2 WHERE user_id = ?`).get(USER_ID).c).toBeGreaterThanOrEqual(2);

        // Users row tombstoned, not deleted.
        const u = _db.prepare(`SELECT username, email, deleted_at FROM users WHERE id = ?`).get(USER_ID);
        expect(u.username).toBe('deleted-user');
        expect(u.email).toBeNull();
        expect(u.deleted_at).not.toBeNull();
    });
});
