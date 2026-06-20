// @vitest-environment node
/**
 * G3 — Self-service data erasure tests
 *
 * Tests:
 *  1. Correct confirmString → erasure executes, user tombstoned.
 *  2. Wrong confirmString → 400.
 *  3. Active subscription present → 400 "cancel subscription first".
 *  4. Audit log retains user.erased event after erasure.
 *  5. Repeat call on tombstoned user → 404.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// In-memory database — swapped per test via Proxy
// ---------------------------------------------------------------------------

let _db;

vi.mock('../db.js', () => ({
    default: new Proxy({}, { get(_t, prop) { return _db[prop]; } }),
}));

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import modules-under-test once (they see the _db Proxy lazily)
// ---------------------------------------------------------------------------

import userDataRouter from '../routes/user-data.js';
import { _resetAuditStatementCache } from '../lib/audit.js';

// ---------------------------------------------------------------------------
// Schema builder
// ---------------------------------------------------------------------------

function buildDb() {
    const db = new Database(':memory:');

    db.exec(`
        CREATE TABLE users (
            id         INTEGER PRIMARY KEY,
            username   TEXT NOT NULL,
            avatar_url TEXT,
            email      TEXT,
            last_login TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        )
    `);

    db.exec(`
        CREATE TABLE audit_log_v2 (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            action        TEXT    NOT NULL,
            resource_type TEXT    NOT NULL,
            resource_id   TEXT,
            details       TEXT,
            ip_address    TEXT,
            user_agent    TEXT,
            api_key_id    TEXT,
            created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
            prev_hash     TEXT    NOT NULL DEFAULT '',
            row_hash      TEXT    NOT NULL DEFAULT ''
        )
    `);

    db.exec(`CREATE TABLE user_ai_config (
        user_id INTEGER PRIMARY KEY,
        completion_provider TEXT,
        completion_model TEXT,
        completion_credentials_enc TEXT,
        embedding_provider TEXT,
        embedding_model TEXT,
        embedding_credentials_enc TEXT,
        feature_overrides_json TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.exec(`CREATE TABLE migration_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'test',
        source_url  TEXT NOT NULL DEFAULT 'http://x',
        source_name TEXT NOT NULL DEFAULT 'x',
        target_owner TEXT NOT NULL DEFAULT 'o',
        target_repo TEXT NOT NULL DEFAULT 'r',
        status TEXT DEFAULT 'pending'
    )`);

    db.exec(`CREATE TABLE migration_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        source_type TEXT NOT NULL DEFAULT 'azure',
        source_org TEXT NOT NULL DEFAULT 'org',
        source_project TEXT NOT NULL DEFAULT 'proj',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    db.exec(`CREATE TABLE pr_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        github_event_id TEXT UNIQUE,
        repo_id INTEGER NOT NULL DEFAULT 1,
        repo_full_name TEXT NOT NULL DEFAULT 'o/r',
        pr_number INTEGER NOT NULL DEFAULT 1,
        action TEXT NOT NULL DEFAULT 'opened',
        author_login TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.exec(`CREATE TABLE issue_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        github_event_id TEXT UNIQUE,
        repo_id INTEGER NOT NULL DEFAULT 1,
        repo_full_name TEXT NOT NULL DEFAULT 'o/r',
        issue_number INTEGER NOT NULL DEFAULT 1,
        action TEXT NOT NULL DEFAULT 'opened',
        author_login TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.exec(`CREATE TABLE review_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL DEFAULT 1,
        repo_full_name TEXT NOT NULL DEFAULT 'o/r',
        pr_number INTEGER NOT NULL DEFAULT 1,
        reviewer_login TEXT NOT NULL,
        state TEXT DEFAULT 'pending',
        UNIQUE (repo_id, pr_number, reviewer_login)
    )`);

    db.exec(`CREATE TABLE community_health_cache (
        repo_id INTEGER NOT NULL DEFAULT 1,
        user_id INTEGER NOT NULL DEFAULT 0,
        health_score INTEGER NOT NULL DEFAULT 50,
        metrics TEXT NOT NULL DEFAULT '{}',
        recommendations TEXT NOT NULL DEFAULT '[]',
        analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_id)
    )`);

    db.exec(`CREATE TABLE repo_metadata (
        repo_id INTEGER NOT NULL DEFAULT 1,
        user_id INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        topics TEXT,
        health_score INTEGER,
        last_indexed TEXT,
        PRIMARY KEY (user_id, repo_id)
    )`);

    db.exec(`CREATE TABLE repo_embeddings (
        repo_id INTEGER NOT NULL DEFAULT 1,
        user_id INTEGER NOT NULL DEFAULT 0,
        embedding TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_id)
    )`);

    db.exec(`CREATE TABLE workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        github_run_id INTEGER UNIQUE NOT NULL DEFAULT 0,
        repo_id INTEGER NOT NULL DEFAULT 1,
        user_id INTEGER NOT NULL DEFAULT 0,
        workflow_id INTEGER NOT NULL DEFAULT 1,
        workflow_name TEXT NOT NULL DEFAULT 'test',
        run_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'completed',
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.exec(`CREATE TABLE workflows_meta (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL DEFAULT 1,
        user_id INTEGER NOT NULL DEFAULT 0,
        github_workflow_id INTEGER UNIQUE NOT NULL DEFAULT 1,
        name TEXT NOT NULL DEFAULT 'test',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.exec(`CREATE TABLE usage_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        metric_type TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        period_start TEXT NOT NULL DEFAULT '2024-01-01',
        period_end TEXT NOT NULL DEFAULT '2024-02-01',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.exec(`CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT 'key',
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL DEFAULT 'grm_',
        scopes TEXT NOT NULL DEFAULT '["read"]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    db.exec(`CREATE TABLE user_subscriptions (
        user_id INTEGER PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'free',
        status TEXT NOT NULL DEFAULT 'active'
    )`);

    db.exec(`CREATE TABLE team_members (
        team_id INTEGER NOT NULL DEFAULT 1,
        user_id INTEGER NOT NULL,
        role TEXT DEFAULT 'member',
        PRIMARY KEY (team_id, user_id)
    )`);

    db.exec(`CREATE TABLE dashboard_inbox_state (
        user_id       INTEGER NOT NULL,
        item_id       TEXT    NOT NULL,
        archived_at   TEXT,
        snoozed_until TEXT,
        PRIMARY KEY (user_id, item_id)
    )`);

    db.exec(`CREATE TABLE repo_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL DEFAULT 1,
        repo_full_name TEXT NOT NULL DEFAULT 'o/r',
        repo_id INTEGER NOT NULL DEFAULT 1,
        assigned_by INTEGER NOT NULL,
        assigned_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    return db;
}

// ---------------------------------------------------------------------------
// App builder — session stub includes accessToken (required by requireAuth)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedUser(id = 42, username = 'alice') {
    _db.prepare(
        `INSERT OR IGNORE INTO users (id, username, email) VALUES (?, ?, ?)`
    ).run(id, username, `${username}@example.com`);
}

function seedSubscription(userId = 42, status = 'active') {
    _db.prepare(
        `INSERT OR IGNORE INTO user_subscriptions (user_id, status) VALUES (?, ?)`
    ).run(userId, status);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
    _db = buildDb();
    // audit.js caches prepared statements bound to a db handle. Reset
    // between tests so each new in-memory db gets fresh statements.
    _resetAuditStatementCache();
});

afterEach(() => {
    _db?.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('G3 — DELETE /api/v1/user/data', () => {
    it('returns 400 when confirmString is wrong', async () => {
        seedUser();
        const app = buildApp();

        const res = await request(app)
            .delete('/api/v1/user/data')
            .send({ confirmString: 'wrong' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/ERASE MY DATA/);
    });

    it('returns 400 when confirmString is missing', async () => {
        seedUser();
        const app = buildApp();

        const res = await request(app)
            .delete('/api/v1/user/data')
            .send({});

        expect(res.status).toBe(400);
    });

    it('returns 400 when user has an active subscription', async () => {
        seedUser();
        seedSubscription(42, 'active');
        const app = buildApp();

        const res = await request(app)
            .delete('/api/v1/user/data')
            .send({ confirmString: 'ERASE MY DATA' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/cancel/i);
    });

    it('tombstones the user and wipes data on valid request', async () => {
        seedUser(42, 'alice');
        // Inactive / cancelled subscription is OK to erase
        seedSubscription(42, 'cancelled');
        _db.prepare(`INSERT INTO user_ai_config (user_id, completion_provider) VALUES (?, ?)`).run(42, 'openai');
        _db.prepare(
            `INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo)
             VALUES (?, 'github', 'http://x', 'x', 'o', 'r')`
        ).run(42);

        const app = buildApp(42);
        const res = await request(app)
            .delete('/api/v1/user/data')
            .send({ confirmString: 'ERASE MY DATA' });

        expect(res.status).toBe(200);
        expect(res.body.tombstoned).toContain('user');
        expect(res.body.deleted.migrationJobs).toBe(1);

        // User row is tombstoned
        const user = _db.prepare(`SELECT username, email, deleted_at FROM users WHERE id = 42`).get();
        expect(user.username).toBe('deleted-user');
        expect(user.email).toBeNull();
        expect(user.deleted_at).not.toBeNull();

        // AI config row is gone
        const aiRow = _db.prepare(`SELECT * FROM user_ai_config WHERE user_id = 42`).get();
        expect(aiRow).toBeUndefined();
    });

    it('erases dashboard_inbox_state and repo_assignments (GDPR completeness)', async () => {
        seedUser(42, 'alice');
        _db.prepare(`INSERT INTO dashboard_inbox_state (user_id, item_id, archived_at) VALUES (?, ?, ?)`)
            .run(42, 'pr:o/r#1', '2026-01-01');
        _db.prepare(`INSERT INTO repo_assignments (team_id, repo_full_name, repo_id, assigned_by) VALUES (?, ?, ?, ?)`)
            .run(1, 'o/r', 1, 42);

        const app = buildApp(42);
        const res = await request(app)
            .delete('/api/v1/user/data')
            .send({ confirmString: 'ERASE MY DATA' });

        expect(res.status).toBe(200);
        expect(_db.prepare(`SELECT * FROM dashboard_inbox_state WHERE user_id = 42`).get()).toBeUndefined();
        expect(_db.prepare(`SELECT * FROM repo_assignments WHERE assigned_by = 42`).get()).toBeUndefined();
        expect(res.body.deleted.dashboardInboxState).toBe(1);
        expect(res.body.deleted.repoAssignments).toBe(1);
    });

    it('retains the user.erased audit event after erasure', async () => {
        seedUser(42, 'alice');
        const app = buildApp(42);

        const res = await request(app)
            .delete('/api/v1/user/data')
            .send({ confirmString: 'ERASE MY DATA' });

        expect(res.status).toBe(200);

        const auditRow = _db.prepare(
            `SELECT * FROM audit_log_v2 WHERE action = 'user.erased' AND user_id = 42`
        ).get();
        expect(auditRow).toBeDefined();
        expect(auditRow.resource_type).toBe('user');
    });

    it('returns 404 on repeat call when user is already tombstoned', async () => {
        seedUser(42, 'alice');
        const app = buildApp(42);

        // First erasure succeeds
        await request(app)
            .delete('/api/v1/user/data')
            .send({ confirmString: 'ERASE MY DATA' });

        // Second call — user is tombstoned, should 404
        const res2 = await request(app)
            .delete('/api/v1/user/data')
            .send({ confirmString: 'ERASE MY DATA' });

        expect(res2.status).toBe(404);
    });
});
