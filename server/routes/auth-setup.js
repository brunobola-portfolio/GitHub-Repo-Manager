// SPDX-License-Identifier: Apache-2.0
/**
 * First-run GitHub OAuth setup — the in-app alternative to hand-editing .env.
 *
 * A packaged/desktop install boots with a generated .env that has strong
 * random secrets but NO GitHub OAuth credentials (scripts/first-run.mjs), so
 * the first "Sign in" click has nowhere to go. These endpoints let the
 * frontend run a guided setup instead:
 *
 *   GET  /api/auth/setup-status  → is OAuth configured? can this client fix it?
 *   POST /api/auth/setup-oauth   → persist Client ID/Secret to .env + apply live
 *
 * Security model for the POST (defense in depth — every layer must pass):
 *   1. Only while OAuth is UNCONFIGURED — the moment credentials exist the
 *      endpoint answers 409 forever (no user can exist before OAuth works,
 *      so there is nothing an attacker can hijack in the open window).
 *   2. Loopback-only: the requesting socket must be 127.0.0.1/::1 AND the
 *      request must not have crossed a reverse proxy (any X-Forwarded-For
 *      denies) — a hosted deployment behind a local proxy never exposes it.
 *   3. CSRF token required — enforced by BOTH the global /api mutation
 *      middleware (server/middleware/csrf.js no longer exempts
 *      /setup-oauth; see B-19 / AUTH_BYPASS_EXACT there) and the explicit
 *      csrfHeaderMatchesSession() check below. The explicit check predates
 *      the narrowed bypass and is kept as defense in depth — deleting it
 *      does NOT remove CSRF coverage the way it used to, but still removes
 *      a layer.
 *   4. Tight rate limit.
 *   5. GRM_DISABLE_WEB_SETUP=true turns the whole surface off for operators
 *      who want .env to be the only configuration channel.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import logger from '../lib/logger.js';
import { auditLog } from '../lib/audit.js';
import { csrfHeaderMatchesSession } from '../middleware/csrf.js';
import { updateEnvFile, resolveEnvFilePath } from '../lib/env-file.js';
import { resolveFrontendUrl } from './auth.js';
import { isLoopbackRequest } from '../lib/loopback.js';

const router = express.Router();

// GitHub OAuth App client IDs are 20 hex chars (legacy) or `Ov23li…`; GitHub
// App IDs are `Iv1.` + 16 hex. Secrets are 40 hex chars today. The patterns
// below are deliberately looser (charset + length band) so a future GitHub
// format change doesn't brick the wizard, while still rejecting junk,
// whitespace and injection attempts outright.
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{10,80}$/;
const CLIENT_SECRET_RE = /^[A-Za-z0-9._-]{20,200}$/;

const setupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many setup attempts, please try again later' },
});

function oauthConfigured() {
    return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

function setupDisabled() {
    // Read live, not config.grmDisableWebSetup: auth-setup.test.js toggles
    // this per-case with no module reset. config.js still validates the
    // value fails fast at real boot on a typo (B-12).
    return process.env.GRM_DISABLE_WEB_SETUP === 'true';
}

// Re-export: pre-existing importers (tests, other routes) resolve it from
// this module; the implementation moved to lib so system routes can share it.
export { isLoopbackRequest };

// Public read: the landing page calls this before deciding what "Sign in"
// does. Leaks nothing sensitive — only whether setup is needed and the exact
// URLs the user must register on GitHub (derived from their own request).
router.get('/setup-status', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    const configured = oauthConfigured();
    res.json({
        oauthConfigured: configured,
        setupDisabled: setupDisabled(),
        canConfigure: !configured && !setupDisabled() && isLoopbackRequest(req),
        homepageUrl: origin,
        callbackUrl: `${origin}/api/auth/callback`,
    });
});

router.post('/setup-oauth', setupLimiter, (req, res) => {
    // Explicit CSRF check, defense-in-depth alongside the global middleware
    // (which no longer exempts this path — B-19). The frontend fetches the
    // token from /api/auth/csrf-token via apiCall() before this call.
    if (!csrfHeaderMatchesSession(req)) {
        return res.status(403).json({ error: 'Invalid CSRF token', code: 'csrf_invalid' });
    }
    if (setupDisabled()) {
        return res.status(403).json({ error: 'Web-based setup is disabled on this deployment (GRM_DISABLE_WEB_SETUP). Edit the .env file instead.' });
    }
    if (oauthConfigured()) {
        return res.status(409).json({ error: 'GitHub OAuth is already configured. Edit the .env file to change credentials.' });
    }
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({ error: 'Setup is only allowed from the machine the server runs on. Edit the .env file instead.' });
    }

    const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.trim() : '';
    const clientSecret = typeof req.body?.clientSecret === 'string' ? req.body.clientSecret.trim() : '';

    if (!CLIENT_ID_RE.test(clientId)) {
        return res.status(400).json({ error: 'That does not look like a GitHub Client ID. Copy it from your OAuth App page (Settings → Developer settings → OAuth Apps).' });
    }
    if (!CLIENT_SECRET_RE.test(clientSecret)) {
        return res.status(400).json({ error: 'That does not look like a GitHub Client Secret. Generate one on your OAuth App page and paste it exactly.' });
    }

    try {
        const { envPath } = updateEnvFile({
            GITHUB_CLIENT_ID: clientId,
            GITHUB_CLIENT_SECRET: clientSecret,
        });

        // Apply live: routes/auth.js reads process.env per-request, so login
        // works immediately — no restart, no window where .env and the running
        // process disagree.
        process.env.GITHUB_CLIENT_ID = clientId;
        process.env.GITHUB_CLIENT_SECRET = clientSecret;

        auditLog(req, 'auth.oauth_setup', 'system', 'github_oauth', { envPath });
        logger.info({ envPath }, 'GitHub OAuth credentials configured via in-app setup');

        return res.json({
            success: true,
            callbackUrl: `${resolveFrontendUrl(req)}/api/auth/callback`,
        });
    } catch (err) {
        logger.error({ err, envPath: resolveEnvFilePath() }, 'Failed to persist OAuth credentials to .env');
        return res.status(500).json({ error: 'Could not write the configuration file. Check that the data directory is writable, or edit the .env file manually.' });
    }
});

export default router;
