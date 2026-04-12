import express from 'express';
import rateLimit from 'express-rate-limit';
import logger from '../lib/logger.js';
import db, { initDB } from '../db.js';
import { requireAuth, safeError } from '../middleware/auth.js';

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

router.post('/setup', requireAuth, async (req, res) => {
    try {
        // Ensure tables exist (idempotent)
        initDB();

        // Seed if empty
        let userCount;
        try {
            userCount = db.prepare('SELECT count(*) as count FROM users').get();
        } catch (dbError) {
            logger.error({ err: dbError }, 'Failed to query user count');
            // If table doesn't exist, assume 0 users
            userCount = { count: 0 };
        }
        if (userCount.count === 0) {
            // We could insert a "System Admin" placeholder or just leave it
        }

        // Mark as completed
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
