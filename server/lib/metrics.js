/*
 * Prometheus metrics — production observability (audit MISSING item 2).
 *
 * Exposes:
 *   - Default Node.js process metrics (event loop lag, heap, GC, etc.) via
 *     prom-client's collectDefaultMetrics().
 *   - http_request_duration_seconds — histogram of request latency, labeled
 *     by method / route / status.
 *   - http_requests_in_flight — gauge of requests currently being handled.
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

import client from 'prom-client';

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
    res.on('finish', () => {
        httpRequestsInFlight.dec();
        const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
        httpRequestDuration.observe(
            { method: req.method, route: normalizeRoute(req), status: res.statusCode },
            durationSeconds
        );
    });
    next();
}

export default register;
