/**
 * K8s-style liveness + readiness probes.
 *
 *   GET /api/health/live   — process is alive. Returns 200 immediately
 *                            unless the server is actively shutting down.
 *                            Used by load balancer / orchestrator for
 *                            "kill if dead".
 *
 *   GET /api/health/ready  — app is ready to serve traffic. Checks:
 *                              - DB connection responsive (SELECT 1)
 *                              - Session store responds (Redis ping
 *                                if REDIS_URL set; otherwise trivial
 *                                SQLite check on the sessions table)
 *                            Each dependency has a 100ms RTT budget.
 *                            Returns 200 when healthy, 503 when degraded
 *                            with a JSON body listing which dependency
 *                            failed.
 *
 * Both endpoints MUST remain unauthenticated and un-rate-limited —
 * probes fire frequently and must work before any user session exists.
 * CSRF bypass is automatic because both are GETs.
 *
 * Backwards-compat: the legacy GET /api/health shallow route (mounted
 * directly in server/index.js) is preserved; these are additive.
 */

import { Router } from 'express';
import db from '../db.js';
import { config } from '../config.js';

const router = Router();

// Tracks whether the process is mid-shutdown. server/index.js flips this
// to true inside gracefulShutdown() so /live immediately reports failure
// and orchestrators stop routing new traffic here.
let shuttingDown = false;

export function markShuttingDown() {
    shuttingDown = true;
}

export function __resetShuttingDownForTests() {
    shuttingDown = false;
}

const CHECK_TIMEOUT_MS = 100;

/**
 * Run a check with a hard ceiling. Returns `ok` when the check resolves
 * within the timeout, or an error descriptor when it throws / times out.
 *
 * @param {() => Promise<void> | void} fn
 * @returns {Promise<'ok' | string>} `'ok'` on success, `'error: <msg>'` on failure
 */
async function timedCheck(fn) {
    const start = Date.now();
    let timer;
    try {
        await Promise.race([
            Promise.resolve().then(fn),
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`timeout after ${CHECK_TIMEOUT_MS}ms`)),
                    CHECK_TIMEOUT_MS,
                );
            }),
        ]);
        const rtt = Date.now() - start;
        if (rtt > CHECK_TIMEOUT_MS) {
            return `error: slow (${rtt}ms)`;
        }
        return 'ok';
    } catch (err) {
        return `error: ${err?.message || String(err)}`;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Liveness probe — returns 200 unless the process is shutting down.
 * Intentionally does NOT touch the DB or any downstream dependency so
 * a degraded dependency can't cause the orchestrator to kill the pod.
 */
router.get('/live', (_req, res) => {
    if (shuttingDown) {
        return res.status(503).json({ status: 'shutting_down' });
    }
    res.json({ status: 'alive' });
});

/**
 * Readiness probe — runs dependency checks. 200 when all pass, 503 when
 * any fail. Body always includes a `checks` map so operators can see
 * which dependency is degraded at a glance.
 */
router.get('/ready', async (_req, res) => {
    const checks = {};

    checks.db = await timedCheck(() => {
        db.prepare('SELECT 1').get();
    });

    checks.session = await timedCheck(async () => {
        if (config.redisUrl) {
            // Lazy-load to avoid pulling ioredis into tests that don't set REDIS_URL
            const { Redis } = await import('ioredis');
            const client = new Redis(config.redisUrl, { lazyConnect: true });
            try {
                await client.connect();
                await client.ping();
            } finally {
                client.disconnect();
            }
        } else {
            // SQLite session store — same underlying DB, but a distinct
            // trivial check keeps the two reports independently meaningful.
            db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
        }
    });

    const healthy = Object.values(checks).every((v) => v === 'ok');
    if (!healthy) {
        return res.status(503).json({ status: 'degraded', checks });
    }
    res.json({ status: 'ready', checks });
});

export default router;
