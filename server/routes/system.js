import express from 'express';
import rateLimit from 'express-rate-limit';
import { createRequire } from 'module';
import logger from '../lib/logger.js';
import db, { initDB } from '../db.js';
import { requireAuth, safeError } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate-request.js';
import { clientErrorSchema } from '../lib/validators.js';
import { config } from '../config.js';
import { checkForUpdate } from '../lib/update-check.js';
import { isLoopbackRequest } from '../lib/loopback.js';
import { isManaged, verifyShutdownToken } from '../lib/managed-runtime.js';
import { requestShutdown } from '../lib/shutdown.js';
import { getDataDir } from '../lib/data-dir.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

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

const shutdownLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many shutdown attempts, please try again in a minute' }
});

const router = express.Router();

router.get('/status', (req, res) => {
    // Boot-time corruption recovery report (adapters/sqlite-adapter.js):
    // null in the overwhelmingly common healthy case. Lets the UI tell the
    // user their database was auto-restored from a backup (or started
    // fresh) instead of silently presenting different data.
    const dbRecovery = db.recovery ?? null;
    try {
        const meta = db.prepare('SELECT value FROM system_meta WHERE key = ?').get('setup_completed');
        res.json({ initialized: meta?.value === 'true', dbRecovery });
    } catch (error) {
        // If table doesn't exist (very fresh), valid to say not initialized
        res.json({ initialized: false, dbRecovery });
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

// Self-hosted "new version available" signal (notify only — no auto-update).
// Authenticated: unlike /source and /status, this makes an outbound request
// on the caller's behalf and returns release metadata, so it isn't left open
// to anonymous callers. Never throws — a check failure degrades to a safe
// "inconclusive" result, never a 500.
router.get('/update-check', requireAuth, async (req, res) => {
    try {
        const result = await checkForUpdate({
            currentVersion: pkg.version,
            disabled: !config.updateCheckEnabled,
        });
        res.json(result);
    } catch (error) {
        logger.error({ err: error }, 'update-check failed unexpectedly');
        res.json({ current: pkg.version });
    }
});

// Client error reporting endpoint (no auth required — errors may occur before
// login). Schema rejects unknown keys so a malicious client can't flood pino
// with arbitrary payloads, and the per-IP rate-limit caps volume.
router.post('/client-error', clientErrorLimiter, validateBody(clientErrorSchema), (req, res) => {
    const { message, stack, url, userAgent, componentStack } = req.validatedBody;
    logger.error({
        message,
        url,
        userAgent,
        componentStack,
        stack,
        reportedAt: new Date().toISOString(),
    }, 'Client error reported');
    res.json({ received: true });
});

// Managed-mode (packaged Windows) graceful stop. Auth is loopback + a
// per-boot secret file token (managed-runtime.js) instead of session/CSRF:
// the legitimate callers — stop.ps1 and the installer's curl — have no
// browser session, while a browser page can never read the token file. The
// path is CSRF-bypassed for exactly that reason (middleware/csrf.js).
router.post('/shutdown', shutdownLimiter, (req, res) => {
    if (!isManaged()) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({ error: 'Shutdown is only accepted from this machine' });
    }
    if (!verifyShutdownToken(getDataDir(), req.get('X-GRM-Shutdown-Token'))) {
        return res.status(403).json({ error: 'Invalid shutdown token' });
    }
    res.status(202).json({ shuttingDown: true });
    // Respond first, then tear down — the caller polls process exit, not the body.
    setImmediate(() => requestShutdown('api'));
});

export default router;
