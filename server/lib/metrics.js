/*
 * Prometheus metrics — production observability (audit MISSING item 2).
 *
 * Exposes:
 *   - Default Node.js process metrics (event loop lag, heap, GC, etc.) via
 *     prom-client's collectDefaultMetrics().
 *   - http_request_duration_seconds — histogram of request latency, labeled
 *     by method / route / status.
 *   - http_requests_in_flight — gauge of requests currently being handled.
 *   - db_backup_age_seconds / db_backup_last_success_timestamp_seconds —
 *     freshness of the newest scheduled SQLite snapshot.
 *   - db_file_size_bytes{file} — size of the live database and its WAL.
 *   - db_queue_depth{queue} — unfinished rows in each background queue.
 *
 * The domain gauges above answer "is this install quietly broken?" before a
 * user notices: backups that silently stopped, a WAL that never checkpoints,
 * an outbox or dead-letter queue that only grows. They are collected LAZILY on
 * scrape (prom-client awaits each metric's `collect`), never on a timer, so an
 * install nobody scrapes pays nothing. Every collector is fully wrapped: a
 * failure clears its own series so the scrape shows a gap instead of a stale
 * value, and never propagates into the /metrics response.
 *
 * Route-label cardinality: the `route` label MUST be the normalized Express
 * route path (e.g. "/api/repos/:owner/:repo"), never the raw URL — raw URLs
 * carry unbounded path params (owner/repo names, ids) that would blow up
 * Prometheus's label cardinality. req.route.path is only populated once
 * Express has matched a route, which has already happened by the time the
 * response 'finish' event fires, so reading it there is safe. Requests that
 * never match a route (404s) fall back to a fixed "unmatched" label.
 *
 * The registry + metric instances are module singletons — importing this
 * file twice (e.g. from index.js and from a test) reuses the same registry
 * rather than double-registering metric names with prom-client (which
 * throws on duplicate registration).
 */

import fs from 'fs';
import client from 'prom-client';
import logger from './logger.js';

export const register = new client.Registry();

// Node process/runtime metrics (CPU, heap, event loop lag, GC, fd count...).
// Guarded so re-importing this module in the same process (tests importing
// both the middleware and the route) doesn't attempt to register the
// default metrics twice.
if (register.getSingleMetric('process_cpu_user_seconds_total') === undefined) {
    client.collectDefaultMetrics({ register });
}

export const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
});

export const httpRequestsInFlight = new client.Gauge({
    name: 'http_requests_in_flight',
    help: 'Number of HTTP requests currently being handled',
    registers: [register],
});

// Background queues worth alerting on, with the predicate that defines an
// "unfinished" row. Table + SQL are fixed literals (never user input).
const QUEUE_DEPTH_QUERIES = [
    { queue: 'gh_outbox', sql: "SELECT COUNT(*) AS n FROM gh_outbox WHERE status = 'pending'" },
    { queue: 'email_dead_letter', sql: 'SELECT COUNT(*) AS n FROM email_dead_letter WHERE resolved_at IS NULL' },
    { queue: 'webhook_events_dead_letter', sql: 'SELECT COUNT(*) AS n FROM webhook_events_dead_letter WHERE resolved_at IS NULL' },
];

export const dbBackupAgeSeconds = new client.Gauge({
    name: 'db_backup_age_seconds',
    help: 'Seconds since the newest scheduled SQLite backup was written (absent when backups are disabled or none exist yet)',
    registers: [register],
});

export const dbBackupLastSuccessTimestamp = new client.Gauge({
    name: 'db_backup_last_success_timestamp_seconds',
    help: 'Unix timestamp of the newest scheduled SQLite backup (absent when backups are disabled or none exist yet)',
    registers: [register],
});

export const dbFileSizeBytes = new client.Gauge({
    name: 'db_file_size_bytes',
    help: 'Size in bytes of the live SQLite database file and its write-ahead log',
    labelNames: ['file'],
    registers: [register],
});

export const dbQueueDepth = new client.Gauge({
    name: 'db_queue_depth',
    help: 'Number of unfinished rows in each background queue table',
    labelNames: ['queue'],
    registers: [register],
});

// One scrape asks four metrics to collect, and prom-client invokes all four
// collectors synchronously before awaiting any of them. Sharing the in-flight
// promise collapses that into one readdir + two stats + three COUNTs per
// scrape; clearing it on settle keeps every *later* scrape fully fresh.
let snapshotInFlight = null;

/**
 * Refresh every domain gauge from the live database and backup directory.
 * Each section is isolated: a failure clears only its own series.
 * @returns {Promise<void>}
 */
async function collectDomainGauges() {
    let activeDb = null;
    try {
        activeDb = (await import('../db.js')).default;
    } catch {
        activeDb = null;
    }

    const dbPath = typeof activeDb?.dbPath === 'string' ? activeDb.dbPath : null;

    try {
        const { resolveBackupDir, newestBackup } = await import('./db-backup.js');
        const backupDir = resolveBackupDir(dbPath);
        const latest = backupDir ? newestBackup(backupDir) : null;
        if (latest) {
            dbBackupAgeSeconds.set(Math.max(0, (Date.now() - latest.timeMs) / 1000));
            dbBackupLastSuccessTimestamp.set(latest.timeMs / 1000);
        } else {
            dbBackupAgeSeconds.remove();
            dbBackupLastSuccessTimestamp.remove();
        }
    } catch {
        dbBackupAgeSeconds.remove();
        dbBackupLastSuccessTimestamp.remove();
    }

    // ':memory:' and the test harness have no file on disk — report nothing
    // rather than a fabricated zero. Same for an absent -wal sidecar.
    const fileBacked = dbPath && !dbPath.startsWith(':memory:') && !dbPath.startsWith('file::memory:');
    for (const [label, suffix] of [['main', ''], ['wal', '-wal']]) {
        let size = null;
        if (fileBacked) {
            try {
                size = fs.statSync(`${dbPath}${suffix}`).size;
            } catch {
                size = null;
            }
        }
        if (size === null) dbFileSizeBytes.remove(label);
        else dbFileSizeBytes.set({ file: label }, size);
    }

    for (const { queue, sql } of QUEUE_DEPTH_QUERIES) {
        try {
            const row = activeDb.prepare(sql).get();
            dbQueueDepth.set({ queue }, Number(row?.n ?? 0));
        } catch {
            dbQueueDepth.remove(queue);
        }
    }
}

/**
 * Collector shared by all domain gauges. Coalesces one scrape's collectors into
 * a single pass and never rejects, so a broken collector can never turn a
 * scrape into a 500.
 * @returns {Promise<void>}
 */
function refreshDomainGauges() {
    if (snapshotInFlight) return snapshotInFlight;
    snapshotInFlight = collectDomainGauges()
        .catch((err) => {
            logger.warn({ err }, '[metrics] domain gauge collection failed');
        })
        .finally(() => {
            snapshotInFlight = null;
        });
    return snapshotInFlight;
}

for (const gauge of [dbBackupAgeSeconds, dbBackupLastSuccessTimestamp, dbFileSizeBytes, dbQueueDepth]) {
    gauge.collect = refreshDomainGauges;
}

// Unlabeled gauges start with a value of 0 already registered, which would
// report "backup taken just now" on an install that has never backed up.
// Clear them so the first scrape reflects reality.
dbBackupAgeSeconds.remove();
dbBackupLastSuccessTimestamp.remove();

/**
 * Normalize a request's path to the matched Express route pattern so the
 * `route` label stays low-cardinality (":owner/:repo" not "octocat/hello").
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function normalizeRoute(req) {
    if (req.route?.path) {
        const base = req.baseUrl || '';
        const routePath = req.route.path === '/' ? '' : req.route.path;
        return `${base}${routePath}` || '/';
    }
    return 'unmatched';
}

/**
 * Express middleware — mount early (before routing) so the in-flight gauge
 * covers the full request lifecycle. Reads req.route on 'finish' (after
 * routing has completed) to normalize the label.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function metricsMiddleware(req, res, next) {
    const started = process.hrtime.bigint();
    httpRequestsInFlight.inc();

    // 'finish' fires only when a response completes normally. An SSE stream the
    // user navigates away from — Deep Review, migration progress — is destroyed
    // instead: 'close' fires, 'finish' never does. Decrementing on 'finish'
    // alone leaked the gauge +1 per abandoned stream, permanently, so after a
    // day of ordinary use http_requests_in_flight reported a load the process
    // was not carrying and any alert built on it was worthless.
    //
    // 'close' always fires, so it is the one that balances the counter. The
    // flag keeps it exactly one dec per inc, since both events fire for a
    // normal response.
    let settled = false;
    const settle = () => {
        if (settled) return;
        settled = true;
        httpRequestsInFlight.dec();
        const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
        httpRequestDuration.observe(
            { method: req.method, route: normalizeRoute(req), status: res.statusCode },
            durationSeconds
        );
    };

    res.on('finish', settle);
    res.on('close', settle);
    next();
}

export default register;
