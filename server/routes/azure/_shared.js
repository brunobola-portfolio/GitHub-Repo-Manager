// Shared helpers + limiters for the Azure sub-routers. Extracted verbatim from
// the former monolithic routes/azure.js so the proxy/validate handlers keep a
// single source of truth for the org/project/pat/host quartet and the rate
// limiters. Behavior-preserving — no logic changes.
import rateLimit from 'express-rate-limit';
import { errorResponse, isValidGitHubUsername } from '../../middleware/auth.js';
import { validateAzureHost } from '../../lib/azure-host-validator.js';
import { resolveAzurePat } from '../../lib/pat-resolver.js';

export const DEFAULT_AZURE_HOST = 'dev.azure.com';

// Upper bound on batch size for enrichment endpoints. Prevents a single
// request from fanning out to thousands of Azure API calls (quota burn / DoS).
export const MAX_BATCH_REPOS = 200;

// Each folder-size computation is a full recursive listing on the TFS side —
// bound the concurrency so one request can't slam an on-prem server with
// dozens of recursive scans at once.
export const FOLDER_SIZE_CONCURRENCY = 5;

/** Resolve and validate the optional host param. Returns null + sends 400 on failure. */
export async function resolveHost(req, res) {
    const host = (req.body?.host || req.query?.host || DEFAULT_AZURE_HOST).toString();
    const check = await validateAzureHost(host);
    if (!check.ok) {
        errorResponse(res, 400, `Azure host rejected: ${check.reason}`, 'INVALID_HOST');
        return null;
    }
    return host;
}

// Single source of truth for PAT priority (vault > pasted > session > env)
// — shared with the migration plan routes via lib/pat-resolver.js.
export function resolvePatFromRequest(req) {
    return resolveAzurePat(req, { patField: 'pat' });
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
export async function resolveAzureContext(req, res, { requireProject = true, requireOrg = true } = {}) {
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

export const orgListLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — try again in a minute' },
});

// Rate limiter for enrichment endpoints: protects Azure API quota from runaway
// clients and parallel-request storms. Each enrichment request can fan-out to
// many Azure calls (batch endpoints) so we cap total endpoint hits per minute.
export const enrichedRepoLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many repo enrichment requests — try again in a minute' },
});
