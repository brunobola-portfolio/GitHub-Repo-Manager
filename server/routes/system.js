import express from 'express';
import db, { initDB } from '../db.js';
import { requireAuth, safeError } from '../middleware/auth.js';

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
        // Simulate "work" for the UI to show progress (optional, but requested for "demonstrating process")
        // In verify real-world, we'd run migrations here.
        // Since initDB() runs at start, we'll verify and maybe seed some data.

        await new Promise(r => setTimeout(r, 1000)); // Simulate "Creating Tables"

        // Ensure tables exist (redundant but safe)
        initDB();

        await new Promise(r => setTimeout(r, 800)); // Simulate "Verifying Schema"

        // Seed if empty
        const userCount = db.prepare('SELECT count(*) as count FROM users').get();
        if (userCount.count === 0) {
            // We could insert a "System Admin" placeholder or just leave it
        }

        await new Promise(r => setTimeout(r, 800)); // Simulate "Seeding Data"

        // Mark as completed
        db.prepare(`
            INSERT INTO system_meta (key, value) VALUES ('setup_completed', 'true')
            ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP
        `).run();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: safeError(error, 'Setup failed') });
    }
});

// Client error reporting endpoint (no auth required - errors may occur before login)
router.post('/client-error', (req, res) => {
    try {
        const { message, stack, componentStack, url, timestamp } = req.body || {};
        console.error('[Client Error]', {
            message: String(message || 'Unknown error').slice(0, 500),
            url: String(url || '').slice(0, 200),
            timestamp: timestamp || new Date().toISOString(),
            stack: String(stack || '').slice(0, 1000)
        });
        res.json({ received: true });
    } catch {
        res.status(200).json({ received: true });
    }
});

export default router;
