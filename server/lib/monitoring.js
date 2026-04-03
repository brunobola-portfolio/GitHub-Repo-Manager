import logger from './logger.js';

let Sentry = null;

export async function initMonitoring() {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return;

    try {
        Sentry = await import('@sentry/node');
        Sentry.init({
            dsn,
            environment: process.env.NODE_ENV || 'development',
            tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        });
        logger.info('Sentry monitoring initialized');
    } catch (err) {
        logger.warn({ err }, 'Failed to initialize Sentry - continuing without monitoring');
    }
}

export function captureError(error, context = {}) {
    if (Sentry) {
        Sentry.captureException(error, { extra: context });
    }
    logger.error({ err: error, ...context }, error.message);
}

export function getSentryErrorHandler() {
    if (Sentry?.expressErrorHandler) {
        return Sentry.expressErrorHandler();
    }
    return (err, _req, _res, next) => next(err);
}
