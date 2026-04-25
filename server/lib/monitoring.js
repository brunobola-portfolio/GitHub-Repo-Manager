import logger from './logger.js';

let Sentry = null;

export async function initMonitoring() {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
        logger.debug('Sentry not configured (SENTRY_DSN unset) — telemetry disabled');
        return;
    }

    const environment = process.env.NODE_ENV || 'development';
    const tracesSampleRate = environment === 'production' ? 0.1 : 1.0;

    try {
        Sentry = await import('@sentry/node');
        Sentry.init({
            dsn,
            environment,
            tracesSampleRate,
        });
        // Log enough context to verify the wiring at boot: which env + sample
        // rate + whether the DSN looks well-formed. If anything is off, the
        // operator can tell at a glance without wrestling with the Sentry UI.
        logger.info(
            { environment, tracesSampleRate, dsnHost: (() => { try { return new URL(dsn).host } catch { return 'invalid' } })() },
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

export function captureError(error, context = {}) {
    if (Sentry) {
        Sentry.captureException(error, { extra: context });
    }
    logger.error({ err: error, ...context }, error.message);
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

export function getSentryErrorHandler() {
    if (Sentry?.expressErrorHandler) {
        return Sentry.expressErrorHandler();
    }
    return (err, _req, _res, next) => next(err);
}
