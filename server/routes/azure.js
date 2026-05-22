import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import * as azureService from '../azure-service.js';
import { requireAuth, safeError, errorResponse, isValidGitHubUsername } from '../middleware/auth.js';
import { encryptCredentials, decryptCredentials } from '../lib/credential-encryption.js';
import db from '../db.js';
import {
    validateAzureHost, isAllowedHost,
    getAllowedHostPatterns, getEnvHostPatterns, getDbHostEntries,
    isUsingDefaultAllowlist,
    addHostToAllowlist, removeHostFromAllowlist,
} from '../lib/azure-host-validator.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { auditLog } from '../lib/audit.js';
import * as credsVault from '../lib/azure-credentials-manager.js';

const DEFAULT_AZURE_HOST = 'dev.azure.com';

/** Resolve and validate the optional host param. Returns null + sends 400 on failure. */
async function resolveHost(req, res) {
    const host = (req.body?.host || req.query?.host || DEFAULT_AZURE_HOST).toString();
    const check = await validateAzureHost(host);
    if (!check.ok) {
        errorResponse(res, 400, `Azure host rejected: ${check.reason}`, 'INVALID_HOST');
        return null;
    }
    return host;
}

/**
 * Resolve a PAT from one of three sources, in priority order:
 *   1. `savedCredentialId` in body → decrypt from per-user vault
 *      (preferred — never round-trips the raw PAT through the browser)
 *   2. `pat` in body                → caller pasted it directly
 *   3. Server env / session         → existing AZURE_PAT fallback
 *
 * Returns `{ pat: string, source: 'vault'|'pasted'|'env' }` on success.
 * Returns `{ pat: null, error: string }` when a savedCredentialId was
 * provided but couldn't be resolved — we deliberately do NOT silently
 * fall back to the env PAT in that case (it's almost always a cloud
 * token that would 401 against the on-prem host the saved credential
 * targeted, producing a confusing error).
 */
function resolvePatFromRequest(req) {
    const body = req.body || {};
    if (body.savedCredentialId) {
        const id = Number(body.savedCredentialId);
        if (!Number.isFinite(id)) {
            return { pat: null, error: 'Invalid savedCredentialId' };
        }
        let pat = null;
        try {
            pat = credsVault.decryptForUse(req.session.userId, id);
        } catch { /* treated as null below */ }
        if (!pat) {
            return {
                pat: null,
                error: 'Saved credential not found or could not be decrypted. It may have been deleted, or the encryption key changed. Open Settings → Azure Credentials to revoke and recreate.',
            };
        }
        return { pat, source: 'vault' };
    }
    const pat = azureService.resolvePat(body.pat, req.session);
    if (!pat) return { pat: null, error: 'No PAT provided and no server PAT configured' };
    return { pat, source: body.pat ? 'pasted' : 'env' };
}

/**
 * One-shot resolver for the org/project/pat/host quartet every Azure
 * endpoint repeats. Centralises:
 *   - Required-field validation
 *   - Cloud-only org name regex (TFS collection names allow hyphens)
 *   - PAT resolution (vault > paste > env)
 *   - Host allowlist + SSRF gate
 *
 * On any failure it writes the HTTP error directly and returns null,
 * so callers can `if (!ctx) return;` and stay readable.
 *
 * @returns {Promise<{ org: string, project: string|null, pat: string, host: string } | null>}
 */
async function resolveAzureContext(req, res, { requireProject = true, requireOrg = true } = {}) {
    const body = req.body || {};
    const org = body.org;
    const project = body.project;
    if (requireOrg && !org) {
        errorResponse(res, 400, 'Organization is required', 'MISSING_ORG');
        return null;
    }
    if (requireProject && !project) {
        errorResponse(res, 400, 'Project is required', 'MISSING_PROJECT');
        return null;
    }
    const hostRaw = (body.host || DEFAULT_AZURE_HOST).toString();
    if (org && hostRaw === DEFAULT_AZURE_HOST && !isValidGitHubUsername(org)) {
        errorResponse(res, 400, 'Invalid organization name', 'INVALID_ORG');
        return null;
    }
    const patResult = resolvePatFromRequest(req);
    if (!patResult.pat) {
        errorResponse(res, 401, patResult.error, 'MISSING_PAT');
        return null;
    }
    const host = await resolveHost(req, res);
    if (!host) return null; // resolveHost already wrote the response
    return { org: org || null, project: project || null, pat: patResult.pat, host };
}

const orgListLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — try again in a minute' },
});

// Rate limiter for enrichment endpoints: protects Azure API quota from runaway
// clients and parallel-request storms. Each enrichment request can fan-out to
// many Azure calls (batch endpoints) so we cap total endpoint hits per minute.
const enrichedRepoLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many repo enrichment requests — try again in a minute' },
});

// Upper bound on batch size for enrichment endpoints. Prevents a single
// request from fanning out to thousands of Azure API calls (quota burn / DoS).
const MAX_BATCH_REPOS = 200;

const router = express.Router();

// Org name validation uses isValidGitHubUsername from auth.js

// Check if server has AZURE_PAT configured (never returns the PAT itself)
router.get('/azure/env-auth', requireAuth, (req, res) => {
    res.json({ available: !!process.env.AZURE_PAT });
});

// Public host allowlist + per-host check. The UI uses this to:
//   1. Pre-validate a hostname before the user submits credentials.
//   2. Show the user exactly which hosts the server will accept.
//   3. Decide whether to offer a 1-click "Add to allowlist" button (admin)
//      or a "Ask your admin" message (non-admin).
//
// Returns DB-managed entries with metadata so the UI can render a richer
// management view, while still exposing only the resolved patterns (no raw
// env strings).
router.get('/azure/host-allowlist', requireAuth, (req, res) => {
    const host = (req.query.host || '').toString().trim().toLowerCase();
    let isAdmin = false;
    try {
        const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
        isAdmin = !!row?.is_admin;
    } catch { /* default false */ }

    res.json({
        patterns: getAllowedHostPatterns(),
        envPatterns: getEnvHostPatterns(),
        dbEntries: getDbHostEntries(),
        usingDefault: isUsingDefaultAllowlist(),
        host: host || null,
        allowed: host ? isAllowedHost(host) : null,
        canEdit: isAdmin,
    });
});

// Admin-only: add a host to the DB allowlist. Takes effect immediately
// (no server restart). Audited via audit_log_v2.
router.post('/azure/host-allowlist', requireAuth, requireAdmin, (req, res) => {
    try {
        const { pattern, notes } = req.body || {};
        if (!pattern) {
            return errorResponse(res, 400, 'Pattern is required', 'MISSING_PATTERN');
        }
        const result = addHostToAllowlist(pattern, req.session.userId, notes || null);
        auditLog(req, 'azure_host_allowlist.add', 'azure_host', result.pattern, {
            notes: notes || null,
            already_existed: !result.added,
        });
        res.status(result.added ? 201 : 200).json(result);
    } catch (error) {
        errorResponse(res, error.status || 400, safeError(error, 'Failed to add host to allowlist'));
    }
});

// Admin-only: remove a host from the DB allowlist. Patterns coming from
// the env var cannot be removed via API (they live in .env).
router.delete('/azure/host-allowlist/:pattern', requireAuth, requireAdmin, (req, res) => {
    try {
        const result = removeHostFromAllowlist(req.params.pattern);
        if (!result.removed) {
            return errorResponse(res, 404, 'Pattern not found in DB allowlist (note: env-var patterns cannot be removed via API)', 'NOT_FOUND');
        }
        auditLog(req, 'azure_host_allowlist.remove', 'azure_host', req.params.pattern, {});
        res.json(result);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to remove host from allowlist'));
    }
});

router.post('/azure/validate', requireAuth, async (req, res) => {
    try {
        const { org } = req.body;
        if (!org) {
            return errorResponse(res, 400, 'Organization is required');
        }
        const host = (req.body?.host || DEFAULT_AZURE_HOST).toString();
        if (host === DEFAULT_AZURE_HOST && !isValidGitHubUsername(org)) {
            return errorResponse(res, 400, 'Invalid organization name');
        }
        const patResult = resolvePatFromRequest(req);
        if (!patResult.pat) {
            // Surface as `{ valid: false, error }` (HTTP 200) so the wizard
            // ConnectionStatusPanel renders the message in the "validate"
            // step instead of going to a generic HTTP error state.
            return res.json({ valid: false, error: patResult.error });
        }
        const validatedHost = await resolveHost(req, res);
        if (!validatedHost) return;
        const result = await azureService.validatePat(org, patResult.pat, validatedHost);
        res.json(result);
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Azure validation failed'));
    }
});

router.post('/azure/projects', requireAuth, async (req, res) => {
    try {
        const { org } = req.body;
        if (!org) {
            return errorResponse(res, 400, 'Organization is required');
        }
        const host = (req.body?.host || DEFAULT_AZURE_HOST).toString();
        if (host === DEFAULT_AZURE_HOST && !isValidGitHubUsername(org)) {
            return errorResponse(res, 400, 'Invalid organization name');
        }
        const patResult = resolvePatFromRequest(req);
        if (!patResult.pat) {
            return errorResponse(res, 400, patResult.error, 'MISSING_PAT');
        }
        const validatedHost = await resolveHost(req, res);
        if (!validatedHost) return;
        const projects = await azureService.listProjects(org, patResult.pat, validatedHost);
        res.json({ projects });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure projects'));
    }
});

// Create a new Azure DevOps project (used by the migration wizard's
// "create new project + repo" target mode). Polls Operations API until
// the project is provisioned, then optionally creates a Git repo inside.
router.post('/azure/projects/create', requireAuth, async (req, res) => {
    try {
        const { name, description, processTemplateId, sourceControlType, repoName } = req.body || {};
        if (!name) {
            return errorResponse(res, 400, 'Project name is required', 'MISSING_PARAMS');
        }
        // `requireProject: false` because we're CREATING the project here.
        const ctx = await resolveAzureContext(req, res, { requireProject: false });
        if (!ctx) return;
        const { org, pat, host } = ctx;

        const created = await azureService.createProject(org, {
            name, description, processTemplateId,
            sourceControlType: sourceControlType || 'Git'
        }, pat, host);

        // Project creation is async — caller polls until ready. We do a brief
        // wait here so common-case responses include a usable project handle.
        let projectInfo = null;
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
                projectInfo = await azureService.getProjectInfo(org, name, pat, host);
                if (projectInfo?.id) break;
            } catch { /* not ready yet */ }
        }

        // Optionally create a Git repo inside the new project
        let createdRepo = null;
        if (repoName && projectInfo?.id) {
            try {
                createdRepo = await azureService.createGitRepo(org, name, repoName, pat, host);
            } catch (e) {
                // Surface but don't fail the whole call — caller can retry just the repo
                return res.status(207).json({
                    project: { id: projectInfo.id, name, operationId: created.operationId },
                    repoError: safeError(e, 'Failed to create repository in new project')
                });
            }
        }

        res.status(201).json({
            project: projectInfo ? { id: projectInfo.id, name: projectInfo.name } : { name, operationId: created.operationId, pending: true },
            repo: createdRepo
        });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to create Azure project'));
    }
});

router.post('/azure/repos', requireAuth, async (req, res) => {
    try {
        const { org, project } = req.body;
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        const host = (req.body?.host || DEFAULT_AZURE_HOST).toString();
        if (host === DEFAULT_AZURE_HOST && !isValidGitHubUsername(org)) {
            return errorResponse(res, 400, 'Invalid organization name');
        }
        const patResult = resolvePatFromRequest(req);
        if (!patResult.pat) {
            return errorResponse(res, 401, patResult.error, 'MISSING_PAT');
        }
        const validatedHost = await resolveHost(req, res);
        if (!validatedHost) return;
        const [repos, projectInfo] = await Promise.all([
            azureService.listRepos(org, project, patResult.pat, validatedHost),
            azureService.getProjectInfo(org, project, patResult.pat, validatedHost).catch(() => null),
        ]);
        const versionControlType = projectInfo?.versionControlType || 'Git';
        res.json({ repos, versionControlType });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure repos'));
    }
});

router.post('/azure/wikis', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const wikis = await azureService.listWikis(ctx.org, ctx.project, ctx.pat, ctx.host);
        res.json({ wikis });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure wikis'));
    }
});

router.post('/azure/work-items/counts', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const counts = await azureService.getWorkItemCounts(ctx.org, ctx.project, ctx.pat, ctx.host);
        res.json({ counts });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to get work item counts'));
    }
});

router.post('/azure/work-items/preview', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const items = await azureService.previewWorkItems(ctx.org, ctx.project, ctx.pat, req.body?.types || [], ctx.host);
        res.json({ items });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to preview work items'));
    }
});

router.post('/azure/project-info', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const info = await azureService.getProjectInfo(ctx.org, ctx.project, ctx.pat, ctx.host);
        res.json(info);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to get project info'));
    }
});

router.post('/azure/branches', requireAuth, async (req, res) => {
    try {
        const { repoId } = req.body || {};
        if (!repoId) return errorResponse(res, 400, 'repoId is required', 'MISSING_REPO_ID');
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const branches = await azureService.listBranches(ctx.org, ctx.project, repoId, ctx.pat, ctx.host);
        res.json({ branches });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list branches'));
    }
});

router.post('/azure/pat-permissions', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;

        const permissions = { code: false, workItems: false, wiki: false };

        // Probe each scope independently so a missing one doesn't mask the others.
        try { await azureService.listRepos(ctx.org, ctx.project, ctx.pat, ctx.host); permissions.code = true; } catch { /* denied */ }
        try { await azureService.getWorkItemCounts(ctx.org, ctx.project, ctx.pat, ctx.host); permissions.workItems = true; } catch { /* denied */ }
        try { await azureService.listWikis(ctx.org, ctx.project, ctx.pat, ctx.host); permissions.wiki = true; } catch { /* denied */ }

        res.json({ permissions });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to check PAT permissions'));
    }
});

router.post('/azure/repos/activity', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repos } = req.body || {};
        if (!Array.isArray(repos)) return errorResponse(res, 400, 'repos[] required', 'MISSING_REPOS');
        if (repos.length > MAX_BATCH_REPOS) {
            return errorResponse(res, 400, `Too many repos per request (max ${MAX_BATCH_REPOS})`, 'TOO_MANY_REPOS');
        }
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const result = await azureService.listRepoActivity(ctx.org, ctx.project, repos, ctx.pat, ctx.host);
        res.json({ activity: result });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch repo activity'));
    }
});

router.post('/azure/repos/lfs-check', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repos } = req.body || {};
        if (!Array.isArray(repos)) return errorResponse(res, 400, 'repos[] required', 'MISSING_REPOS');
        if (repos.length > MAX_BATCH_REPOS) {
            return errorResponse(res, 400, `Too many repos per request (max ${MAX_BATCH_REPOS})`, 'TOO_MANY_REPOS');
        }
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const result = await azureService.checkLfsMarkers(ctx.org, ctx.project, repos, ctx.pat, ctx.host);
        res.json({ lfs: result });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to check LFS markers'));
    }
});

router.post('/azure/repos/commit-activity', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repoId, defaultBranch, months } = req.body || {};
        if (!repoId) return errorResponse(res, 400, 'repoId is required', 'MISSING_REPO_ID');
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const activity = await azureService.getCommitActivity(ctx.org, ctx.project, repoId, defaultBranch, ctx.pat, months || 12, ctx.host);
        res.json({ activity });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch commit activity'));
    }
});

router.post('/azure/repos/readme', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repoId, ref } = req.body || {};
        if (!repoId) return errorResponse(res, 400, 'repoId is required', 'MISSING_REPO_ID');
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const readme = await azureService.getRepoReadme(ctx.org, ctx.project, repoId, ctx.pat, ref, ctx.host);
        res.json(readme);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch README'));
    }
});

router.post('/azure/repos/full-stats', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repoId, defaultBranch } = req.body || {};
        if (!repoId) return errorResponse(res, 400, 'repoId is required', 'MISSING_REPO_ID');
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const stats = await azureService.getRepoFullStats(ctx.org, ctx.project, repoId, defaultBranch, ctx.pat, ctx.host);
        res.json(stats);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch full stats'));
    }
});

router.post('/azure/tfvc/items', requireAuth, async (req, res) => {
    try {
        const { scopePath } = req.body || {};
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const items = await azureService.listTfvcItems(ctx.org, ctx.project, ctx.pat, scopePath, ctx.host);
        // Compute actual folder sizes via recursive listing
        const enriched = await Promise.all(items.map(async (item) => {
            if (item.isFolder && item.path) {
                try {
                    const size = await azureService.getTfvcFolderSize(ctx.org, ctx.project, ctx.pat, item.path, ctx.host);
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
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
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

// ───────────────────────────────────────────────────────────────────────
// Azure credentials vault (per-user, encrypted PATs)
//
// The migration wizard reads from this vault so users don't re-paste a
// token on every session. Managed from Settings → Azure Credentials.
// PAT values are NEVER returned by list/get endpoints — only `prefix`.
// ───────────────────────────────────────────────────────────────────────

// GET /api/azure/credentials — list current user's saved credentials,
// optionally filtered by host so the wizard can show host-matching ones.
router.get('/azure/credentials', requireAuth, (req, res) => {
    try {
        const host = req.query.host ? String(req.query.host) : null;
        const items = credsVault.listForUser(req.session.userId, { host });
        res.json({ items });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list credentials'));
    }
});

// POST /api/azure/credentials — store a new credential. Body shape:
//   { label, host, org?, pat, scopes? }
router.post('/azure/credentials', requireAuth, (req, res) => {
    try {
        const body = req.body || {};
        const created = credsVault.create(req.session.userId, body);
        auditLog(req, 'azure_credential.create', 'azure_credential', created.id, {
            host: created.host, org: created.org, label: created.label,
        });
        res.status(201).json(created);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to save credential'));
    }
});

// PATCH /api/azure/credentials/:id — update label / org / scopes (NOT the
// PAT — to rotate, delete + recreate so the prefix stays in sync).
router.patch('/azure/credentials/:id', requireAuth, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return errorResponse(res, 400, 'Invalid id', 'BAD_ID');
        const updated = credsVault.update(req.session.userId, id, req.body || {});
        auditLog(req, 'azure_credential.update', 'azure_credential', id, {});
        res.json(updated);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to update credential'));
    }
});

// DELETE /api/azure/credentials/:id — revoke (the actual PAT in Azure DevOps
// is NOT revoked here, only the local cache; user should also delete it on
// the Azure side via the "Open PAT page" link in the UI).
router.delete('/azure/credentials/:id', requireAuth, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return errorResponse(res, 400, 'Invalid id', 'BAD_ID');
        const removed = credsVault.remove(req.session.userId, id);
        auditLog(req, 'azure_credential.remove', 'azure_credential', id, {
            host: removed.host, org: removed.org, label: removed.label,
        });
        res.json({ removed: true, id });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to delete credential'));
    }
});

// POST /api/azure/credentials/:id/test — validate the stored PAT against
// the linked host/org. Useful from Settings to spot revoked tokens early.
router.post('/azure/credentials/:id/test', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return errorResponse(res, 400, 'Invalid id', 'BAD_ID');
        const cred = credsVault.getPublic(req.session.userId, id);
        if (!cred) return errorResponse(res, 404, 'Credential not found', 'NOT_FOUND');
        if (!cred.org) {
            return res.json({
                valid: false,
                error: 'Credential has no org configured — edit it and set the organization first.',
            });
        }
        const hostCheck = await validateAzureHost(cred.host);
        if (!hostCheck.ok) {
            return res.json({ valid: false, error: `Host check failed: ${hostCheck.reason}` });
        }
        const pat = credsVault.decryptForUse(req.session.userId, id);
        if (!pat) return errorResponse(res, 500, 'Could not decrypt credential', 'DECRYPT_FAILED');
        const result = await azureService.validatePat(cred.org, pat, cred.host);
        res.json(result);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to test credential'));
    }
});

export default router;
