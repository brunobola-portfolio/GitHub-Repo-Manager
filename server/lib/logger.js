import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Structural secret-redaction backstop.
 *
 * Call-site discipline (never logging `req.session.accessToken`, using
 * redactSecrets on AI-bound content, etc.) is the first line of defence, but a
 * single future `logger.error({ err })` where the error object carries request
 * config/headers (axios-style / provider-SDK errors) would otherwise ship live
 * GitHub/Azure tokens into logs and Sentry breadcrumbs. These paths censor the
 * common secret-bearing shapes structurally so that never happens.
 *
 * Exported so tests can assert the coverage without reaching into pino internals.
 */
export const REDACT_PATHS = [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.headers.authorization',
    '*.headers.Authorization',
    '*.headers.cookie',
    'err.config.headers.authorization',
    'err.config.headers.Authorization',
    'err.config.headers',
    '*.accessToken',
    '*.access_token',
    '*.refreshToken',
    '*.refresh_token',
    '*.token',
    '*.pat',
    '*.apiKey',
    '*.api_key',
    '*.password',
    '*.sessionSecret',
    'password',
    'token',
    'accessToken',
];

/**
 * Structured logger for the server.
 * Uses pino for fast, JSON-structured logging.
 * In development: pretty-prints for readability.
 * In production / test: outputs JSON (avoids pino-pretty transport that breaks
 * vitest worker bootstrap — the worker can't resolve the transport target).
 */
const logger = pino({
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : isTest ? 'silent' : 'debug'),
    transport: (isProduction || isTest) ? undefined : {
        target: 'pino-pretty',
        options: { colorize: true }
    },
    formatters: {
        level(label) {
            return { level: label };
        }
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Backstop redaction for secret-bearing paths (see REDACT_PATHS above).
    redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
    },
    base: {
        service: 'github-repo-manager'
    }
});

/**
 * Create a child logger with request context
 * @param {import('express').Request} req
 * @returns {pino.Logger}
 */
export function createRequestLogger(req) {
    return logger.child({
        requestId: req.id || req.headers['x-request-id'] || generateRequestId(),
        method: req.method,
        path: req.path,
        userId: req.session?.userId || null
    });
}

/**
 * Express middleware that attaches a request logger and logs request/response
 */
export function requestLoggerMiddleware(req, res, next) {
    // Preserve the id already assigned by the request-id middleware in
    // server/index.js (which is what we send back to the client via the
    // X-Request-Id header). Only fall back to generating one if this
    // middleware somehow runs first, so the logged requestId always equals
    // the header the client saw.
    req.id = req.id || req.headers['x-request-id'] || generateRequestId();
    req.log = createRequestLogger(req);

    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            statusCode: res.statusCode,
            duration,
            contentLength: res.get('content-length')
        };

        if (res.statusCode >= 500) {
            req.log.error(logData, 'request failed');
        } else if (res.statusCode >= 400) {
            req.log.warn(logData, 'request error');
        } else if (duration > 5000) {
            req.log.warn(logData, 'slow request');
        }
    });

    next();
}

let requestCounter = 0;

function generateRequestId() {
    return `req_${Date.now()}_${(++requestCounter).toString(36)}`;
}

export default logger;
