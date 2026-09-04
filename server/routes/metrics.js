/*
 * GET /metrics — Prometheus scrape endpoint.
 *
 * Deliberately mounted outside the /api/* prefix: scrapers shouldn't be
 * subject to the CSRF, per-tenant rate-limit, or tier-attachment middleware
 * built for the app API. Auth is still mandatory — see metrics-auth.js.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register } from '../lib/metrics.js';
import { metricsAuth } from '../middleware/metrics-auth.js';
import { safeError } from '../middleware/auth.js';

const router = Router();

// Living outside /api/* also means living outside globalLimiter and
// apiLimiter, so the METRICS_TOKEN bearer path had no ceiling of any kind.
// The token comparison is timing-safe, so the exposure is volumetric rather
// than an oracle — 120/min is generous for any real scraper (Prometheus
// defaults to one scrape every 15 s) while still bounding a flood.
const metricsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many metrics requests', code: 'RATE_LIMITED' },
});

router.get('/', metricsLimiter, metricsAuth, async (req, res) => {
    try {
        // Collect first, then set the header: stamping the Prometheus
        // content-type up front made the error branch below inherit it, and
        // res.json() will not overwrite a Content-Type that is already set.
        const body = await register.metrics();
        res.set('Content-Type', register.contentType);
        res.end(body);
    } catch (err) {
        res.status(500).json({
            error: safeError(err, 'metrics collection failed'),
            code: 'SERVER_ERROR',
        });
    }
});

export default router;
