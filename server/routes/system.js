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
import { startUpdate, getUpdateProgress, readAndClearUpdateResult, UpdateError } from '../lib/updater.js';

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

// Low ceiling — a self-update downloads a release asset and hands off to an
// installer/PowerShell script; there is never a legitimate reason to start
// more than a couple of these in a five-minute window.
const updateLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many update attempts, please try again later' }
});

const router = express.Router();

router.get('/status', (req, res) => {
    // Boot-time corruption recovery report (adapters/sqlite-adapter.js):
    // null in the overwhelmingly common healthy case. Lets the UI tell the
    // user their database was auto-restored from a backup (or started
    // fresh) instead of silently presenting different data.
    const dbRecovery = db.recovery ?? null;
    // Read-and-clear: a client that never polled /update/status while an
    // update applied still learns the outcome exactly once, on its first
    // status check after the restart. Only meaningful for a managed install.
    const updateResult = isManaged() ? readAndClearUpdateResult(getDataDir()) : null;
    try {
        const meta = db.prepare('SELECT value FROM system_meta WHERE key = ?').get('setup_completed');
        res.json({ initialized: meta?.value === 'true', dbRecovery, updateResult });
    } catch (error) {
        // If table doesn't exist (very fresh), valid to say not initialized
        res.json({ initialized: false, dbRecovery, updateResult });
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

// Machine-readable provenance. Under AGPL this endpoint discharged the §13
// source-disclosure obligation; under Apache-2.0 there is no such obligation
// and it is kept deliberately, as a courtesy: an operator running a modified
// build can point downstream consumers at their own source, and anyone can
// check what a deployment claims to be without reading its HTML.
//
// Forks: update `sourceUrl` to your own repository. Nothing compels you to —
// that is the difference — but a deployment that answers with someone else's
// repository is telling its users something untrue.
router.get('/source', (req, res) => {
    res.json({
        license: 'Apache-2.0',
        sourceUrl: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager',
        trademarksUrl: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/TRADEMARKS.md',
        notice: 'Apache-2.0 grants broad rights over the code and none over the RepoManager name or mark.'
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
        // Self-update (download + run the packaged installer) only makes sense
        // for a managed Windows install — anything else must fall back to the
        // manual releaseUrl link.
        res.json({ ...result, canSelfUpdate: isManaged() && process.platform === 'win32' });
    } catch (error) {
        logger.error({ err: error }, 'update-check failed unexpectedly');
        res.json({ current: pkg.version, canSelfUpdate: false });
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

// Managed-mode (packaged Windows) one-click self-update. Loopback-only for
// the same reason as /shutdown — this triggers a real download + installer
// handoff + process shutdown, so it must never be reachable from a browser
// tab an attacker lured onto a malicious page. Session auth (requireAuth)
// still applies on top: unlike /shutdown this has no separate boot-secret
// token, since the caller here is always the logged-in Settings page.
router.post('/update', updateLimiter, requireAuth, async (req, res) => {
    if (!isManaged() || process.platform !== 'win32') {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({ error: 'Updates can only be started from this machine' });
    }
    try {
        await startUpdate({
            currentVersion: pkg.version,
            dataDir: getDataDir(),
            packageRoot: process.env.GRM_PACKAGE_ROOT,
        });
        res.status(202).json({ updating: true });
    } catch (error) {
        if (error instanceof UpdateError) {
            const status = error.code === 'already_running' ? 409 : 400;
            return res.status(status).json({ error: error.message, code: error.code });
        }
        res.status(500).json({ error: safeError(error, 'Update failed to start') });
    }
});

// Progress poll for the Settings-page update UI (phase/percent/error/target).
router.get('/update/status', requireAuth, (req, res) => res.json(getUpdateProgress()));

export default router;
