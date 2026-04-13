import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Structured logger for the server.
 * Uses pino for fast, JSON-structured logging.
 * In development: pretty-prints for readability.
 * In production: outputs JSON for log aggregation.
 */
const logger = pino({
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    transport: isProduction ? undefined : {
        target: 'pino-pretty',
        options: { colorize: true }
    },
    formatters: {
        level(label) {
            return { level: label };
        }
    },
    timestamp: pino.stdTimeFunctions.isoTime,
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
    req.id = req.headers['x-request-id'] || generateRequestId();
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
