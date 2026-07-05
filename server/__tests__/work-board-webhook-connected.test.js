// @vitest-environment node
/**
 * Work Board — "webhook connected" indicator (meta.webhookConnected)
 *
 * Regression guard for the bug where /my-reviews probed `webhook_events` — the
 * STRIPE idempotency ledger — to decide whether GitHub webhooks were wired up.
 * GitHub webhook ingestion writes pr_events / issue_events / deployment_events,
 * so on a self-hosted deploy with working GitHub webhooks and no Stripe traffic
 * the indicator was permanently stuck "not connected".
 *
 * These tests run the real router against a real (in-memory) schema and toggle
 * rows in each GitHub event table to assert the indicator reads the right ones.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// db.js: keep the REAL named exports (initDB, etc.); swap only the default
// singleton for a per-test in-memory handle the router reads through.
vi.hoisted(() => { process.env.DATABASE_URL = 'sqlite::memory:'; });

let _db;
vi.mock('../db.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, default: new Proxy({}, { get(_t, prop) { return _db[prop]; } }) };
});

// Minimal lib mocks so the endpoint resolves without live GitHub / cache work.
vi.mock('../lib/event-aggregations.js', () => ({
    listMyPendingReviews: () => [],
    listStalePRs: () => [],
    listMyOpenIssues: () => [],
    deployFrequency: () => ({ totalDeployments: 0, perDay: [] }),
    leadTimeForChanges: () => ({ sampleSize: 0 }),
    reviewLoadByReviewer: () => [],
    changeFailureRate: () => ({ total: 0 }),
    meanTimeToRecovery: () => ({ sampleSize: 0 }),
    listTechDebtIssues: () => [],
    techDebtHotspots: () => [],
}));
vi.mock('../lib/work-board-cache.js', () => ({
    getCached: () => null, putCached: vi.fn(), invalidate: vi.fn(), purgeExpired: vi.fn(),
}));
vi.mock('../lib/work-board-github.js', () => ({
    fetchMyPendingReviews: async () => ({ items: [] }),
    fetchStalePRs: async () => ({ items: [] }),
    fetchMyOpenIssues: async () => ({ items: [] }),
    fetchTechDebtIssues: async () => ({ items: [] }),
    DEFAULT_DEBT_LABELS: [],
}));
vi.mock('../lib/work-board-filter.js', () => ({ applyTrackedFilter: (_u, items) => items }));
vi.mock('../lib/work-board-snooze.js', () => ({ filterOutSnoozed: ({ items }) => items }));
vi.mock('../lib/work-board-kpi-snapshots.js', () => ({ getSnapshots: () => [] }));
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => next(),
    errorResponse: (res, status, message) => res.status(status).json({ error: message }),
    safeError: (_e, fallback) => fallback,
}));
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (req, res, next) => next(),
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_r, _s, n) => n(),
}));
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Database from 'better-sqlite3';
import { initDB } from '../db.js';

const { default: workBoardRouter } = await import('../routes/work-board.js');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId: 1, accessToken: 'ghp_x', userLogin: 'alice' };
        next();
    });
    app.use('/api/v1/work-board', workBoardRouter);
    return app;
}

beforeEach(() => {
    _db = new Database(':memory:');
    _db.pragma('foreign_keys = ON');
    initDB(_db);
});

afterEach(() => { _db?.close(); });

async function readWebhookConnected() {
    const res = await request(buildApp()).get('/api/v1/work-board/my-reviews');
    expect(res.status).toBe(200);
    return res.body.meta.webhookConnected;
}

describe('work-board meta.webhookConnected', () => {
    it('is false when no GitHub webhook events have been ingested', async () => {
        expect(await readWebhookConnected()).toBe(false);
    });

    it('is true when pr_events has rows', async () => {
        _db.prepare(
            `INSERT INTO pr_events (repo_id, repo_full_name, pr_number, action, author_login)
             VALUES (1, 'o/r', 1, 'opened', 'alice')`,
        ).run();
        expect(await readWebhookConnected()).toBe(true);
    });

    it('is true when only issue_events has rows', async () => {
        _db.prepare(
            `INSERT INTO issue_events (repo_id, repo_full_name, issue_number, action, author_login)
             VALUES (1, 'o/r', 1, 'opened', 'alice')`,
        ).run();
        expect(await readWebhookConnected()).toBe(true);
    });

    it('is true when only deployment_events has rows', async () => {
        _db.prepare(
            `INSERT INTO deployment_events (repo_id, repo_full_name, environment, state)
             VALUES (1, 'o/r', 'production', 'success')`,
        ).run();
        expect(await readWebhookConnected()).toBe(true);
    });

    it('ignores webhook_events (the Stripe idempotency ledger)', async () => {
        // Stripe traffic populates webhook_events; that must NOT flip the GitHub
        // webhook indicator on when no GitHub events have been ingested.
        _db.prepare(
            `INSERT INTO webhook_events (id, source, type, processed_at)
             VALUES ('evt_1', 'stripe', 'checkout.session.completed', 0)`,
        ).run();
        expect(await readWebhookConnected()).toBe(false);
    });
});
