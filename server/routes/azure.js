import crypto from 'node:crypto';
import express from 'express';
import * as azureService from '../azure-service.js';
import { requireAuth, safeError, errorResponse } from '../middleware/auth.js';

const router = express.Router();

// Check if server has AZURE_PAT configured (never returns the PAT itself)
router.get('/azure/env-auth', requireAuth, (req, res) => {
    res.json({ available: !!process.env.AZURE_PAT });
});

router.post('/azure/validate', requireAuth, async (req, res) => {
    try {
        const { org, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org) {
            return errorResponse(res, 400, 'Organization is required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const result = await azureService.validatePat(org, pat);
        res.json(result);
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Azure validation failed'));
    }
});

router.post('/azure/projects', requireAuth, async (req, res) => {
    try {
        const { org, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org) {
            return errorResponse(res, 400, 'Organization is required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const projects = await azureService.listProjects(org, pat);
        res.json({ projects });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure projects'));
    }
});

router.post('/azure/repos', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const repos = await azureService.listRepos(org, project, pat);
        // When no Git repos found, check if project uses TFVC
        let versionControlType = null;
        if (repos.length === 0) {
            try {
                const info = await azureService.getProjectInfo(org, project, pat);
                versionControlType = info.versionControlType;
            } catch { /* degrade gracefully */ }
        }
        res.json({ repos, ...(versionControlType ? { versionControlType } : {}) });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure repos'));
    }
});

router.post('/azure/wikis', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const wikis = await azureService.listWikis(org, project, pat);
        res.json({ wikis });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure wikis'));
    }
});

router.post('/azure/work-items/counts', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const counts = await azureService.getWorkItemCounts(org, project, pat);
        res.json({ counts });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to get work item counts'));
    }
});

router.post('/azure/work-items/preview', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat, types } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const items = await azureService.previewWorkItems(org, project, pat, types || []);
        res.json({ items });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to preview work items'));
    }
});

router.post('/azure/project-info', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const info = await azureService.getProjectInfo(org, project, pat);
        res.json(info);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to get project info'));
    }
});

router.post('/azure/branches', requireAuth, async (req, res) => {
    try {
        const { org, project, repoId, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org || !project || !repoId) {
            return errorResponse(res, 400, 'Organization, project, and repoId are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const branches = await azureService.listBranches(org, project, repoId, pat);
        res.json({ branches });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list branches'));
    }
});

router.post('/azure/pat-permissions', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }

        const permissions = { code: false, workItems: false, wiki: false };

        // Test Code (Read) — try listing repos
        try {
            await azureService.listRepos(org, project, pat);
            permissions.code = true;
        } catch { /* permission denied or error */ }

        // Test Work Items (Read) — try WIQL query
        try {
            await azureService.getWorkItemCounts(org, project, pat);
            permissions.workItems = true;
        } catch { /* permission denied or error */ }

        // Test Wiki (Read) — try listing wikis
        try {
            await azureService.listWikis(org, project, pat);
            permissions.wiki = true;
        } catch { /* permission denied or error */ }

        res.json({ permissions });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to check PAT permissions'));
    }
});

router.post('/azure/tfvc/items', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat, scopePath } = req.body;
        const pat = azureService.resolvePat(bodyPat, req.session);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const items = await azureService.listTfvcItems(org, project, pat, scopePath);
        // Compute actual folder sizes via recursive listing
        const enriched = await Promise.all(items.map(async (item) => {
            if (item.isFolder && item.path) {
                try {
                    const size = await azureService.getTfvcFolderSize(org, project, pat, item.path);
                    return { ...item, size };
                } catch {
                    return item; // keep original (0) on error
                }
            }
            return item;
        }));
        res.json({ items: enriched });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list TFVC items'));
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

    if (!state || state !== req.session.oauthState) {
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
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
        );
        const tokenData = await tokenRes.json();
        if (tokenData.access_token) {
            req.session.azureToken = tokenData.access_token;
            req.session.azureTokenReady = true;
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
