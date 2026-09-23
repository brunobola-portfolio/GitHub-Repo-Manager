import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import logger from './logger.js';

let Sentry = null;

// Per-request context for error reports. Sentry's own per-request isolation
// depends on its HTTP instrumentation, which in ESM only exists when the SDK
// is loaded through `node --import` before Express — this server initialises
// it in-process instead. Calling Sentry.setUser() here would therefore write
// to one process-wide scope and attribute one tenant's error to whoever made
// the next request. Every event carries its own user/tags instead, read from
// this store.
const requestContext = new AsyncLocalStorage();

const APP_VERSION = (() => {
    try {
        return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
    } catch {
        return undefined;
    }
})();

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key', 'x-hub-signature', 'x-hub-signature-256', 'stripe-signature'];
const SENSITIVE_QUERY = /([?&](?:code|state|token|access_token|refresh_token|key|api_key|secret)=)[^&#]*/gi;

/** Pseudonymous, stable id for a user: the same user groups together in Sentry, the raw id never leaves. */
function pseudonymousUserId(userId) {
    if (userId == null) return undefined;
    const salt = process.env.SESSION_SECRET || 'grm';
    return createHash('sha256').update(`${salt}:${userId}`).digest('hex').slice(0, 16);
}

function scrubUrl(url) {
    return typeof url === 'string' ? url.replace(SENSITIVE_QUERY, '$1[Filtered]') : url;
}

/**
 * Strip what a multi-tenant deployment must never ship to a third party:
 * credentials in headers, OAuth codes and tokens in query strings, cookies
 * and request bodies (they can hold repository content or keys).
 */
export function scrubEvent(event) {
    if (event?.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
            for (const name of Object.keys(event.request.headers)) {
                if (SENSITIVE_HEADERS.includes(name.toLowerCase())) event.request.headers[name] = '[Filtered]';
            }
        }
        if (event.request.url) event.request.url = scrubUrl(event.request.url);
        if (typeof event.request.query_string === 'string') {
            event.request.query_string = scrubUrl(`?${event.request.query_string}`).slice(1);
        }
    }
    if (Array.isArray(event?.breadcrumbs)) {
        for (const b of event.breadcrumbs) {
            if (b?.data?.url) b.data.url = scrubUrl(b.data.url);
        }
    }
    return event;
}

export async function initMonitoring() {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
        logger.debug('Sentry not configured (SENTRY_DSN unset) — telemetry disabled');
        return;
    }

    const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
    // Tracing needs the HTTP instrumentation described above; without it the
    // SDK has nothing to trace, so it stays off unless an operator opts in.
    const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0);
    const release = APP_VERSION ? `github-repo-manager@${APP_VERSION}` : undefined;

    try {
        Sentry = await import('@sentry/node');
        Sentry.init({
            dsn,
            environment,
            release,
            tracesSampleRate,
            sendDefaultPii: false,
            initialScope: { tags: { deployment_mode: process.env.DEPLOYMENT_MODE || 'self-hosted' } },
            beforeSend: scrubEvent,
            beforeBreadcrumb: (b) => {
                if (b?.data?.url) b.data.url = scrubUrl(b.data.url);
                return b;
            },
        });
        // Log enough context to verify the wiring at boot: which env + sample
        // rate + whether the DSN looks well-formed. If anything is off, the
        // operator can tell at a glance without wrestling with the Sentry UI.
        logger.info(
            { environment, release, tracesSampleRate, dsnHost: (() => { try { return new URL(dsn).host } catch { return 'invalid' } })() },
            'Sentry monitoring initialized',
        );
    } catch (err) {
        // Don't silently degrade — log the full error at WARN so invalid DSNs
        // (typos, expired projects, wrong region) surface on startup instead
        // of manifesting as "telemetry mysteriously missing" days later.
        logger.warn(
            { err, dsnHost: (() => { try { return new URL(dsn).host } catch { return 'invalid' } })() },
            'Sentry init failed — continuing without monitoring. Check SENTRY_DSN validity.',
        );
        Sentry = null;
    }
}

/**
 * Express middleware, mounted after the session: every error report made
 * while this request is in flight carries its request id, route and the
 * pseudonymous id of the signed-in user.
 */
export function monitoringContext(req, _res, next) {
    requestContext.run({ req }, next);
}

function eventContext() {
    const req = requestContext.getStore()?.req;
    if (!req) return {};
    const userId = req.session?.userId;
    return {
        user: userId != null ? { id: pseudonymousUserId(userId) } : undefined,
        tags: {
            request_id: req.id,
            route: `${req.method} ${req.baseUrl || ''}${req.route?.path || req.path || ''}`.slice(0, 200),
            tier: req.userTier,
        },
    };
}

/**
 * Send an exception to Sentry without logging it (callers that already log
 * use this). 4xx-class errors are the caller's or upstream's problem — a
 * GitHub 404, a validation failure — and would drown real faults, so only
 * errors with no status or a 5xx status are reported.
 */
export function reportException(error, context = {}) {
    if (!Sentry || !error) return;
    const status = error.status ?? error.statusCode ?? error.response?.status;
    if (typeof status === 'number' && status < 500) return;
    const { user, tags } = eventContext();
    Sentry.captureException(error, {
        user,
        tags: { ...tags, ...(context.tags || {}) },
        extra: context.extra || (context.tags ? undefined : context),
    });
}

/**
 * Record a non-error operational event. Used for things like AI key health
 * probe outcomes — we want a breadcrumb trail to debug 'why is the bell
 * showing my key as invalid' without raising it as a Sentry exception.
 *
 * Always logs at the requested level via the structured logger; when Sentry
 * is configured, also emits as a breadcrumb so it shows up in any subsequent
 * captured exception's context.
 *
 * @param {object} args
 * @param {string} args.event       — short identifier, e.g. 'ai.probe_outcome'
 * @param {string} [args.level]     — 'info' | 'warning' | 'error' (default 'info')
 * @param {object} [args.data]      — structured fields
 * @param {string} [args.message]   — human-readable summary
 */
export function captureBreadcrumb({ event, level = 'info', data = {}, message }) {
    if (Sentry?.addBreadcrumb) {
        Sentry.addBreadcrumb({
            category: event,
            level,
            data,
            message,
        });
    }
    const logFn = logger[level === 'warning' ? 'warn' : level] || logger.info;
    logFn.call(logger, { event, ...data }, message ?? event);
}

/**
 * Last-resort handler for errors that escape every route. Reports through
 * the same path as handled errors so they carry the request context.
 */
export function getSentryErrorHandler() {
    return (err, _req, _res, next) => {
        reportException(err);
        next(err);
    };
}

// ---------------------------------------------------------------------------
// Browser telemetry
// ---------------------------------------------------------------------------

/**
 * The DSN the browser should use, from the runtime environment so one build
 * serves every deployment (a self-hosted install sets its own, or none).
 * A DSN is public by design — it only allows sending events — so exposing it
 * in the page is expected.
 */
export function browserDsn() {
    const dsn = process.env.SENTRY_BROWSER_DSN || '';
    try {
        const u = new URL(dsn);
        const projectId = u.pathname.replace(/^\/+|\/+$/g, '');
        if (!u.username || !/^\d+$/.test(projectId)) return null;
        return { dsn, host: u.host, projectId };
    } catch {
        return null;
    }
}

/**
 * Sentry tunnel: the browser SDK posts envelopes to our own origin, which
 * forwards them to Sentry. Keeps the CSP at connect-src 'self', survives ad
 * blockers that drop *.sentry.io, and never lets the page reveal a visitor's
 * IP to a third party. Only envelopes addressed to the configured project are
 * forwarded — anything else is a 400, so this cannot be used as an open relay.
 */
export async function sentryTunnelHandler(req, res) {
    const target = browserDsn();
    if (!target) return res.status(404).json({ error: 'Browser telemetry is not configured', code: 'NOT_FOUND' });
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''), 'utf8');
    const newline = body.indexOf(0x0a);
    let header;
    try {
        header = JSON.parse(body.subarray(0, newline === -1 ? body.length : newline).toString('utf8'));
    } catch {
        return res.status(400).json({ error: 'Malformed envelope', code: 'BAD_ENVELOPE' });
    }
    let dsn;
    try {
        dsn = new URL(header?.dsn);
    } catch {
        return res.status(400).json({ error: 'Envelope has no DSN', code: 'BAD_ENVELOPE' });
    }
    const projectId = dsn.pathname.replace(/^\/+|\/+$/g, '');
    if (dsn.host !== target.host || projectId !== target.projectId) {
        return res.status(400).json({ error: 'Envelope is not for this project', code: 'BAD_ENVELOPE' });
    }
    try {
        const upstream = await fetch(`https://${target.host}/api/${target.projectId}/envelope/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-sentry-envelope' },
            body,
            signal: AbortSignal.timeout(5000),
        });
        return res.status(upstream.status >= 500 ? 502 : upstream.status).end();
    } catch (err) {
        logger.warn({ err: err?.message }, 'Sentry tunnel forward failed');
        return res.status(502).end();
    }
}
