/*
 * Per-request timing middleware.
 *
 * Mounted early in the middleware chain so the clock starts before any
 * other handler runs. Emits a single structured log line on response
 * finish with method / path / status / durationMs / userId.
 *
 * Log-level routing:
 *   - 5xx  → error
 *   - 4xx  → warn
 *   - >1s  → warn (slow)
 *   - else → debug (so 200 responses don't spam at info level)
 */
import logger from '../lib/logger.js';

export function requestTiming(req, res, next) {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        const log = req.log || logger;
        const entry = {
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Math.round(durationMs * 10) / 10,
            userId: req.session?.userId,
        };
        if (res.statusCode >= 500) {
            log.error(entry, 'request:error');
        } else if (res.statusCode >= 400) {
            log.warn(entry, 'request:warn');
        } else if (durationMs > 1000) {
            log.warn(entry, 'request:slow');
        } else {
            log.debug(entry, 'request:ok');
        }
    });
    next();
}

export default requestTiming;
