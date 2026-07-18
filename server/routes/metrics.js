/*
 * GET /metrics — Prometheus scrape endpoint.
 *
 * Deliberately mounted outside the /api/* prefix: scrapers shouldn't be
 * subject to the CSRF, per-tenant rate-limit, or tier-attachment middleware
 * built for the app API. Auth is still mandatory — see metrics-auth.js.
 */

import { Router } from 'express';
import { register } from '../lib/metrics.js';
import { metricsAuth } from '../middleware/metrics-auth.js';

const router = Router();

router.get('/', metricsAuth, async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (err) {
        res.status(500).end(err?.message || 'metrics collection failed');
    }
});

export default router;
