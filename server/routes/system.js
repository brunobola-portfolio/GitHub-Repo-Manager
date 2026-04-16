import express from 'express';
import rateLimit from 'express-rate-limit';
import logger from '../lib/logger.js';
import db, { initDB } from '../db.js';
import { safeError } from '../middleware/auth.js';

// Rate-limit setup so an unauthenticated endpoint can't be hammered.
const setupLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many setup attempts, please try again in a minute' }
});

const clientErrorLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many error reports, please try again later' }
});

const router = express.Router();

router.get('/status', (req, res) => {
    try {
        const meta = db.prepare('SELECT value FROM system_meta WHERE key = ?').get('setup_completed');
        res.json({ initialized: meta?.value === 'true' });
    } catch (error) {
        // If table doesn't exist (very fresh), valid to say not initialized
        res.json({ initialized: false });
    }
});

// Initial system setup. Intentionally unauthenticated — by definition the
// system isn't yet usable, and no user account can exist until setup
// completes. The operation is idempotent (initDB creates-if-missing, the
// meta flag is an upsert) and rate-limited to prevent abuse.
router.post('/setup', setupLimiter, async (req, res) => {
    try {
        // Short-circuit if already set up — no need to re-run initDB.
        try {
            const existing = db.prepare('SELECT value FROM system_meta WHERE key = ?').get('setup_completed');
            if (existing?.value === 'true') {
                return res.json({ success: true, alreadyInitialized: true });
            }
        } catch {
            // Table may not exist yet on first run — fall through to initDB.
        }

        initDB();

        try {
            db.prepare(`
                INSERT INTO system_meta (key, value) VALUES ('setup_completed', 'true')
                ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP
            `).run();
        } catch (metaError) {
            logger.error({ err: metaError }, 'Failed to update system_meta');
            throw metaError;
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: safeError(error, 'Setup failed') });
    }
});

// AGPL §13 source-disclosure endpoint (machine-readable). Forks should update
// `sourceUrl` to point at their own modified source so downstream consumers
// can find it programmatically.
router.get('/source', (req, res) => {
    res.json({
        license: 'AGPL-3.0-only',
        sourceUrl: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager',
        commercialLicenseUrl: 'https://bolalabs.pt/license',
        notice: 'Modified versions running as a network service must offer their corresponding source under AGPL §13.'
    });
});

// Client error reporting endpoint (no auth required - errors may occur before login)
router.post('/client-error', clientErrorLimiter, (req, res) => {
    try {
        const { message, stack, url, timestamp } = req.body || {};
        logger.error({
            message: String(message || 'Unknown error').slice(0, 500),
            url: String(url || '').slice(0, 200),
            timestamp: timestamp || new Date().toISOString(),
            stack: String(stack || '').slice(0, 1000)
        }, 'Client error reported');
        res.json({ received: true });
    } catch {
        res.status(200).json({ received: true });
    }
});

export default router;
