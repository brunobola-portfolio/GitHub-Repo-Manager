// Azure AD OAuth flow + org listing. The callback intentionally omits
// requireAuth (popup redirect; CSRF covered by timing-safe state check).
// Extracted verbatim from routes/azure.js.
import crypto from 'node:crypto';
import express from 'express';
import * as azureService from '../../azure-service.js';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import { encryptCredentials, decryptCredentials } from '../../lib/credential-encryption.js';
import { orgListLimiter } from './_shared.js';

const router = express.Router();

// GET /api/azure/organizations — list orgs for the authenticated user (OAuth only)
router.get('/azure/organizations', requireAuth, orgListLimiter, async (req, res) => {
    try {
        const encryptedToken = req.session?.azureToken;
        if (!encryptedToken) {
            return errorResponse(res, 401, 'OAuth session required — authenticate via OAuth first');
        }
        const { token } = decryptCredentials(encryptedToken);
        const organizations = await azureService.listOrganizations(token);
        res.json({ organizations });
    } catch (error) {
        if (error.status === 401) {
            return errorResponse(res, 401, 'Token expired or invalid — please re-authenticate');
        }
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list organizations'));
    }
});

// GET /api/azure/oauth-status
router.get('/azure/oauth-status', requireAuth, (req, res) => {
    const configured = !!(
        process.env.AZURE_CLIENT_ID &&
        process.env.AZURE_CLIENT_SECRET &&
        process.env.AZURE_TENANT_ID
    );
    res.json({ configured });
});

// GET /api/azure/oauth/start — redirect to Azure AD
router.get('/azure/oauth/start', requireAuth, (req, res) => {
    const { AZURE_CLIENT_ID, AZURE_TENANT_ID } = process.env;
    if (!AZURE_CLIENT_ID || !AZURE_TENANT_ID) {
        return res.status(503).json({ error: 'OAuth not configured' });
    }
    const redirectUri = encodeURIComponent(`${req.protocol}://${req.get('host')}/api/azure/oauth/callback`);
    const scope = encodeURIComponent('https://app.vssps.visualstudio.com/.default');
    const state = crypto.randomBytes(16).toString('hex');
    // Clear any previous OAuth session state so retries start clean
    req.session.oauthState = state;
    delete req.session.azureTokenReady;
    delete req.session.azureTokenError;
    const authUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize` +
        `?client_id=${AZURE_CLIENT_ID}` +
        `&response_type=code` +
        `&redirect_uri=${redirectUri}` +
        `&scope=${scope}` +
        `&state=${state}`;
    res.redirect(authUrl);
});

// GET /api/azure/oauth/callback — exchange code for token
// Note: requireAuth is intentionally omitted — this runs in a popup tab where session
// cookies may not be sent with a redirect. State validation provides CSRF protection.
router.get('/azure/oauth/callback', async (req, res) => {
    const { code, state } = req.query;
    const { AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID } = process.env;

    if (!AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !AZURE_TENANT_ID) {
        return res.status(503).send('<html><body><p>OAuth not configured.</p></body></html>');
    }

    if (!code) {
        return res.status(400).send('<html><body><p>OAuth error: no code received.</p></body></html>');
    }

    const stateA = state ? Buffer.from(state) : null;
    const stateB = req.session.oauthState ? Buffer.from(req.session.oauthState) : null;
    const stateValid = stateA && stateB &&
        stateA.length === stateB.length &&
        crypto.timingSafeEqual(stateA, stateB);
    if (!stateValid) {
        return res.status(400).send('<html><body><p>OAuth error: invalid state parameter.</p></body></html>');
    }
    delete req.session.oauthState;

    try {
        const redirectUri = `${req.protocol}://${req.get('host')}/api/azure/oauth/callback`;
        const body = new URLSearchParams({
            client_id: AZURE_CLIENT_ID,
            client_secret: AZURE_CLIENT_SECRET,
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            scope: 'https://app.vssps.visualstudio.com/.default',
        });
        const tokenRes = await fetch(
            `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
                // Same reasoning as the GitHub token exchange in routes/auth.js.
                signal: AbortSignal.timeout(15_000),
            }
        );
        const tokenData = await tokenRes.json();
        if (tokenData.access_token) {
            const encryptedToken = encryptCredentials({ token: tokenData.access_token });
            // Regenerate session to prevent session fixation (matching GitHub OAuth flow)
            req.session.regenerate((regenErr) => {
                if (regenErr) {
                    req.log?.error?.({ err: regenErr }, 'Failed to regenerate session after Azure OAuth');
                    // Fall back to saving on the existing session
                    req.session.azureToken = encryptedToken;
                    req.session.azureTokenReady = true;
                    req.session.save(() => {});
                    return;
                }
                req.session.azureToken = encryptedToken;
                req.session.azureTokenReady = true;
                req.session.save((saveErr) => {
                    if (saveErr) req.log?.error?.({ err: saveErr }, 'Failed to save Azure session');
                });
            });
        }
    } catch {
        req.session.azureTokenError = true;
        return res.send(`<!DOCTYPE html>
<html><head><title>Authentication Failed</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px">
  <h2>Authentication failed</h2>
  <p>Token exchange error. Please close this tab and try again.</p>
  <script>window.close();</script>
</body></html>`);
    }

    res.send(`<!DOCTYPE html>
<html><head><title>Authentication Complete</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px">
  <h2>Authentication complete</h2>
  <p>You can close this tab.</p>
  <script>window.close();</script>
</body></html>`);
});

// GET /api/azure/oauth/token — polling endpoint (never sends token to client)
router.get('/azure/oauth/token', requireAuth, (req, res) => {
    res.json({
        ready: !!req.session.azureTokenReady,
        error: !!req.session.azureTokenError,
    });
});

export default router;
