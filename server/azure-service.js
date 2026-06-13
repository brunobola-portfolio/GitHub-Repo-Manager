/**
 * Azure DevOps Service
 * Handles all Azure DevOps REST API interactions (API v7.1)
 * Auth: Basic auth with PAT (Personal Access Token)
 *
 * Host-aware: every export accepts an optional trailing `host` parameter
 * (default `'dev.azure.com'`) so the same code paths work for Azure DevOps
 * cloud, *.visualstudio.com, and on-premises TFS 2018+ servers. Hosts
 * other than the cloud are routed through `/tfs/DefaultCollection` by
 * `resolveAzureBaseUrl` in `lib/azure-host-validator.js`.
 */

import { decryptCredentials } from './lib/credential-encryption.js';
import { resolveAzureBaseUrl, encodePathSegments, classifyAzureHost } from './lib/azure-host-validator.js';
import { basicAuthHeader } from './lib/basic-auth-header.js';

const DEFAULT_HOST = 'dev.azure.com';
const API_VERSION = '7.1';

/** Build the per-org base URL for a host. */
function baseFor(host) {
    return resolveAzureBaseUrl(host || DEFAULT_HOST);
}

/**
 * Encode an org value safely for URL paths. On-prem TFS orgs may include
 * a collection-prefix slash (e.g. "tfs/DefaultCollection") — those slashes
 * MUST be preserved literally; only the segment values are URL-escaped.
 */
function encOrg(org) {
    return encodePathSegments(org || '');
}

/**
 * Base URL up to and including the org/collection path segment.
 *
 *   - dev.azure.com:           https://dev.azure.com/{org}
 *   - {acct}.visualstudio.com: https://{acct}.visualstudio.com
 *   - on-prem TFS:             https://{host}/{collection}
 *
 * For the legacy *.visualstudio.com format the account IS the subdomain, so it
 * must NOT be repeated in the path — `https://acct.visualstudio.com/acct/_apis`
 * 404s on every call. dev.azure.com (cloud) and on-prem TFS both carry the
 * org/collection in the path, so it's appended there.
 */
function orgBaseFor(host, org) {
    const origin = baseFor(host);
    return classifyAzureHost(host).orgInPath ? `${origin}/${encOrg(org)}` : origin;
}

/**
 * Status-accurate message for a failed Azure DevOps response. A 404 means the
 * org/collection/URL is wrong — NOT a credentials problem — so it must not be
 * reported as "check your PAT". Only 401/403 are genuine auth failures.
 */
function azureHttpErrorMessage(status, statusText) {
    if (status === 404) {
        return 'Azure DevOps resource not found (HTTP 404). Check the organization/collection in the URL.';
    }
    if (status === 401 || status === 403) {
        return `Azure DevOps authentication failed (HTTP ${status}). Check your PAT scopes and expiry.`;
    }
    return `Azure DevOps API error: ${status} ${statusText || ''}`.trim();
}

/**
 * Resolve PAT: use provided value, or fall back to encrypted session token, or AZURE_PAT env var.
 * @param {string|undefined} pat - PAT from request body (may be undefined)
 * @param {object|undefined} session - Express session (may be undefined)
 * @returns {string|null}
 */
function resolvePat(pat, session) {
    if (pat) return pat;
    if (session?.azureToken) {
        try {
            const { token } = decryptCredentials(session.azureToken);
            return token;
        } catch {
            return null;
        }
    }
    return process.env.AZURE_PAT || null;
}

function getHeaders(pat) {
    return {
        'Authorization': basicAuthHeader('', pat),
        'Content-Type': 'application/json'
    };
}

// Hard request timeout. A slow or unreachable on-prem TFS would otherwise hang
// a request indefinitely, tying up an Express connection. Tuned generously so
// legitimately slow servers still complete; large downloads override it.
const AZURE_TIMEOUT_MS = 30_000;
// Idempotent GET/polling requests retry on transient upstream failures
// (network error, timeout, 429, 5xx). Base delay doubles each attempt.
const AZURE_RETRY_ATTEMPTS = 2;
const AZURE_RETRY_BASE_MS = Number(process.env.AZURE_RETRY_BASE_MS) || 400;

function azureSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableAzureStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
}

/**
 * fetch wrapper for Azure DevOps. Enforces a hard timeout via
 * `AbortSignal.timeout` (so a slow/on-prem TFS can't hang forever) and, for
 * idempotent requests (`retry: true`), retries transient failures — network
 * error, timeout, 429, 5xx — with exponential backoff honouring `Retry-After`.
 * Mutations (POST/PUT/PATCH/DELETE) must NOT set `retry` so they never replay.
 *
 * Returns the raw Response so callers keep using res.ok / res.json() / res.text().
 */
async function azureRawFetch(url, options = {}, { retry = false, timeoutMs = AZURE_TIMEOUT_MS } = {}) {
    const maxAttempts = retry ? AZURE_RETRY_ATTEMPTS + 1 : 1;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
            if (retry && attempt < maxAttempts && isRetryableAzureStatus(res.status)) {
                const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
                const delay = Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : AZURE_RETRY_BASE_MS * 2 ** (attempt - 1);
                await azureSleep(delay);
                continue;
            }
            return res;
        } catch (err) {
            lastErr = err;
            // AbortSignal.timeout -> TimeoutError; aborted -> AbortError;
            // network failure -> TypeError. All transient for idempotent reads.
            const transient = err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.name === 'TypeError';
            if (retry && transient && attempt < maxAttempts) {
                await azureSleep(AZURE_RETRY_BASE_MS * 2 ** (attempt - 1));
                continue;
            }
            if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
                const timeoutErr = new Error(`Azure DevOps request timed out after ${Math.round(timeoutMs / 1000)}s. The server may be slow or unreachable.`);
                timeoutErr.status = 504;
                timeoutErr.code = 'azure_timeout';
                throw timeoutErr;
            }
            throw err;
        }
    }
    throw lastErr;
}

async function azureFetch(url, pat, options = {}) {
    if (!pat) {
        throw new Error('Azure DevOps PAT is required. Configure AZURE_PAT in .env or provide a personal PAT.');
    }

    const method = (options.method || 'GET').toUpperCase();
    const res = await azureRawFetch(url, {
        ...options,
        headers: {
            ...getHeaders(pat),
            ...options.headers
        }
    }, { retry: method === 'GET' });

    // Check content-type before parsing — Azure returns HTML on auth failures
    const contentType = res.headers.get('content-type') || '';

    if (!res.ok) {
        // Azure returns an HTML error page (not JSON) for some failures —
        // notably 404s on a wrong org/collection. Prefer Azure's own JSON
        // message when present, else a status-accurate generic. ALWAYS set
        // `status` (even for HTML) so callers like validatePat can branch on
        // 404 vs 401 instead of treating every failure as an auth problem.
        const isHtml = contentType.includes('text/html');
        const body = isHtml ? null : await res.json().catch(() => null);
        const error = new Error(body?.message || azureHttpErrorMessage(res.status, res.statusText));
        error.status = res.status;
        throw error;
    }

    if (contentType.includes('text/html')) {
        throw new Error('Azure DevOps returned HTML instead of JSON. This usually means authentication failed.');
    }

    return res.json();
}

/**
 * Validate a PAT against an Azure DevOps organization.
 *
 * On-prem TFS discovery: if the org isn't already prefixed with `tfs/` and
 * the first probe returns 404, we retry once with `tfs/<org>` because some
 * TFS deployments expose collections under a `/tfs/` virtual directory.
 * Returns the actually-working `org` value via the `resolvedOrg` field so
 * the caller can persist it (avoids repeating the probe on every request).
 */
async function validatePat(org, pat, host = DEFAULT_HOST) {
    if (!org || !pat) {
        return { valid: false, error: 'Organization and PAT are required' };
    }

    const tryProbe = async (orgValue) => {
        const url = `${orgBaseFor(host, orgValue)}/_apis/projects?api-version=${API_VERSION}&$top=1`;
        await azureFetch(url, pat);
    };

    try {
        await tryProbe(org);
        return { valid: true, resolvedOrg: org };
    } catch (e) {
        // Only attempt on-prem `/tfs/` fallback for non-cloud hosts and only
        // when the org isn't already collection-prefixed. Cloud servers will
        // never need this path.
        const { isCloud } = classifyAzureHost(host);
        const alreadyPrefixed = org.toLowerCase().startsWith('tfs/');
        if (!isCloud && !alreadyPrefixed && (e.status === 404 || e.status === 302)) {
            try {
                const alt = `tfs/${org}`;
                await tryProbe(alt);
                return { valid: true, resolvedOrg: alt };
            } catch {
                // fall through to original error
            }
        }
        if (e.status === 401 || e.status === 403) {
            return { valid: false, error: 'Invalid or insufficient PAT permissions' };
        }
        if (e.status === 404) {
            return {
                valid: false,
                error: isCloud
                    ? `Organization "${org}" not found at ${host}. Check the organization name in the URL.`
                    : `Collection "${org}" not found on ${host}. For TFS on-prem, the collection path may differ — try pasting the full URL with /tfs/<collection>/ if the server uses a virtual directory.`
            };
        }
        return { valid: false, error: e.message };
    }
}

/**
 * List projects in an Azure DevOps organization.
 *
 * Paginates via the `x-ms-continuationtoken` response header so collections
 * with more than the page size (common on long-lived on-prem TFS servers
 * with hundreds of projects) return *all* projects rather than just the
 * first page. Without this, URL paste of a project past the first page
 * silently failed to match and the user saw "No matches found" + the
 * wizard's "Project is required" error.
 *
 * Hard-capped at 20 pages (10k projects with the default $top=500) so a
 * malformed server response can't cause an unbounded fetch loop.
 */
async function listProjects(org, pat, host = DEFAULT_HOST) {
    const all = [];
    const seen = new Set();
    let continuationToken = null;
    const MAX_PAGES = 20;
    const PAGE_SIZE = 500;

    for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
            'api-version': API_VERSION,
            '$top': String(PAGE_SIZE),
        });
        if (continuationToken) params.set('continuationToken', continuationToken);
        const url = `${orgBaseFor(host, org)}/_apis/projects?${params.toString()}`;

        // Inline fetch (instead of azureFetch) because we need the
        // `x-ms-continuationtoken` response header — azureFetch only
        // exposes the JSON body. Error handling mirrors azureFetch.
        const res = await azureRawFetch(url, { headers: getHeaders(pat) }, { retry: true });
        const contentType = res.headers.get('content-type') || '';
        if (!res.ok) {
            // Mirrors azureFetch: status-accurate message + always set status.
            const isHtml = contentType.includes('text/html');
            const body = isHtml ? null : await res.json().catch(() => null);
            const error = new Error(body?.message || azureHttpErrorMessage(res.status, res.statusText));
            error.status = res.status;
            throw error;
        }
        if (contentType.includes('text/html')) {
            throw new Error('Azure DevOps returned HTML instead of JSON. This usually means authentication failed.');
        }
        const data = await res.json();

        for (const p of (data.value || [])) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            all.push({
                id: p.id,
                name: p.name,
                description: p.description || '',
                state: p.state,
                url: p.url,
                lastUpdateTime: p.lastUpdateTime,
            });
        }

        continuationToken = res.headers.get('x-ms-continuationtoken');
        if (!continuationToken) break;
    }

    return all;
}

/**
 * Create a new project (Azure DevOps Projects API). Used by the migration
 * wizard when the user picks the "create new project + repo" target mode.
 *
 * @param {string} org
 * @param {{ name: string, description?: string, processTemplateId?: string, sourceControlType?: 'Git'|'Tfvc' }} payload
 * @param {string} pat
 * @param {string} [host]
 * @returns {Promise<{ id: string, name: string, url: string, operationId?: string }>}
 */
async function createProject(org, payload, pat, host = DEFAULT_HOST) {
    if (!payload?.name) throw new Error('createProject: project name required');
    const url = `${orgBaseFor(host, org)}/_apis/projects?api-version=${API_VERSION}`;
    const body = {
        name: payload.name,
        description: payload.description || '',
        capabilities: {
            versioncontrol: { sourceControlType: payload.sourceControlType || 'Git' },
            processTemplate: {
                templateTypeId: payload.processTemplateId || 'adcc42ab-9882-485e-a3ed-7678f01f66bc' // "Agile" default
            }
        }
    };
    const data = await azureFetch(url, pat, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    // Project creation is asynchronous — Azure returns an operation reference.
    return {
        id: data.id || null,
        operationId: data.id || null,
        name: payload.name,
        url: data.url || ''
    };
}

/**
 * Detect server capabilities by probing well-known API endpoints. Used by
 * the TFVC migration cascade to decide whether to attempt the modern
 * Import Request API (TFS 2018+ / Azure DevOps cloud) or fall back to
 * git-tfs / ZIP snapshot.
 *
 * @returns {Promise<{ hasImportApi: boolean, hasTfvcApi: boolean }>}
 */
async function detectCapabilities(org, pat, host = DEFAULT_HOST) {
    const base = orgBaseFor(host, org);
    const probe = async (path) => {
        try {
            const url = `${base}/${path}`;
            await azureFetch(url, pat);
            return true;
        } catch (e) {
            // 404 = endpoint missing on this server; 200/4xx with auth = present
            if (e.status === 401 || e.status === 403) return true;
            return false;
        }
    };
    const [hasImportApi, hasTfvcApi] = await Promise.all([
        probe(`_apis/git/repositories?api-version=${API_VERSION}&$top=1`),
        probe(`_apis/tfvc/items?api-version=${API_VERSION}&$top=1`)
    ]);
    return { hasImportApi, hasTfvcApi };
}

/**
 * List repositories in a project
 */
async function listRepos(org, project, pat, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return (data.value || []).map(r => ({
        id: r.id,
        name: r.name,
        defaultBranch: r.defaultBranch || '',
        remoteUrl: r.remoteUrl,
        sshUrl: r.sshUrl || '',
        webUrl: r.webUrl,
        size: r.size || 0,
        isFork: r.isFork || false,
        isDisabled: r.isDisabled || false,
        project: {
            id: r.project?.id,
            name: r.project?.name
        }
    }));
}

/**
 * Get repository details including clone URL
 */
async function getRepoDetails(org, project, repoName, pat, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoName)}?api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return {
        id: data.id,
        name: data.name,
        defaultBranch: data.defaultBranch || '',
        remoteUrl: data.remoteUrl,
        sshUrl: data.sshUrl || '',
        webUrl: data.webUrl,
        size: data.size || 0,
        isFork: data.isFork || false
    };
}

/**
 * List branches for a repository
 */
async function listBranches(org, project, repoId, pat, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/refs?filter=heads/&api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return (data.value || []).map(ref => ({
        name: ref.name.replace('refs/heads/', ''),
        objectId: ref.objectId
    }));
}

/**
 * List wikis in a project
 */
async function listWikis(org, project, pat, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/wiki/wikis?api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return (data.value || []).map(w => ({
        id: w.id,
        name: w.name,
        type: w.type,
        remoteUrl: w.remoteUrl || ''
    }));
}

/**
 * Get work item counts grouped by type using WIQL
 */
async function getWorkItemCounts(org, project, pat, host = DEFAULT_HOST) {
    const base = orgBaseFor(host, org);
    const url = `${base}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=${API_VERSION}`;
    const wiql = `SELECT [System.Id], [System.WorkItemType] FROM workitems WHERE [System.TeamProject] = '${escapeWiql(project)}'`;
    const data = await azureFetch(url, pat, {
        method: 'POST',
        body: JSON.stringify({ query: wiql })
    });

    const ids = (data.workItems || []).map(wi => wi.id);
    if (ids.length === 0) return {};

    const counts = {};
    for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const detailUrl = `${base}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(',')}&fields=System.WorkItemType&api-version=${API_VERSION}`;
        const details = await azureFetch(detailUrl, pat);
        for (const item of (details.value || [])) {
            const type = item.fields?.['System.WorkItemType'] || 'Unknown';
            counts[type] = (counts[type] || 0) + 1;
        }
    }

    return counts;
}

/**
 * Preview work items (top 10 per type) using WIQL
 */
async function previewWorkItems(org, project, pat, types, host = DEFAULT_HOST) {
    const base = orgBaseFor(host, org);
    const items = [];

    for (const type of types) {
        const url = `${base}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=${API_VERSION}`;
        const wiql = `SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = '${escapeWiql(project)}' AND [System.WorkItemType] = '${escapeWiql(type)}' ORDER BY [System.Id] DESC`;
        const data = await azureFetch(url, pat, {
            method: 'POST',
            body: JSON.stringify({ query: wiql, $top: 10 })
        });

        const ids = (data.workItems || []).slice(0, 10).map(wi => wi.id);
        if (ids.length === 0) continue;

        const detailUrl = `${base}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo&api-version=${API_VERSION}`;
        const details = await azureFetch(detailUrl, pat);
        for (const item of (details.value || [])) {
            items.push({
                id: item.id,
                title: item.fields?.['System.Title'] || '',
                type: item.fields?.['System.WorkItemType'] || '',
                state: item.fields?.['System.State'] || '',
                assignedTo: item.fields?.['System.AssignedTo']?.displayName || ''
            });
        }
    }

    return items;
}

/**
 * Fetch full work item details by IDs (with relations)
 */
async function fetchWorkItems(org, project, pat, ids, host = DEFAULT_HOST) {
    if (!ids || ids.length === 0) return [];

    const base = orgBaseFor(host, org);
    const results = [];
    for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const url = `${base}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=relations&api-version=${API_VERSION}`;
        const data = await azureFetch(url, pat);
        results.push(...(data.value || []));
    }

    return results;
}

/**
 * Get wiki clone URL by wiki ID
 */
async function getWikiCloneUrl(org, project, pat, wikiId, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/wiki/wikis/${encodeURIComponent(wikiId)}?api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return data.remoteUrl || '';
}

/**
 * Get project info including version control type (Git or Tfvc)
 */
async function getProjectInfo(org, project, pat, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/_apis/projects/${encodeURIComponent(project)}?includeCapabilities=true&api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return {
        id: data.id,
        name: data.name,
        versionControlType: data.capabilities?.versioncontrol?.sourceControlType || 'Git'
    };
}

/**
 * List TFVC items (files/folders) under a given path
 */
async function listTfvcItems(org, project, pat, scopePath, host = DEFAULT_HOST) {
    const path = scopePath || `$/${project}`;
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/tfvc/items?scopePath=${encodeURIComponent(path)}&recursionLevel=OneLevel&api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return (data.value || []).filter(item => item.path !== path).map(item => ({
        path: item.path,
        isFolder: item.isFolder || false,
        size: item.size || 0,
        changeDate: item.changeDate || null,
        url: item.url || ''
    }));
}

/**
 * Get total size of a TFVC folder by recursively listing all files.
 */
async function getTfvcFolderSize(org, project, pat, scopePath, host = DEFAULT_HOST) {
    const path = scopePath || `$/${project}`;
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/tfvc/items?scopePath=${encodeURIComponent(path)}&recursionLevel=Full&api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return (data.value || [])
        .filter(item => !item.isFolder)
        .reduce((sum, item) => sum + (item.size || 0), 0);
}

/**
 * Create a new Git repository in Azure DevOps (used as temp target for TFVC import)
 */
async function createGitRepo(org, project, repoName, pat, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat, {
        method: 'POST',
        body: JSON.stringify({ name: repoName })
    });
    return {
        id: data.id,
        name: data.name,
        remoteUrl: data.remoteUrl,
        webUrl: data.webUrl
    };
}

/**
 * Trigger TFVC-to-Git import using Azure DevOps Import Request API
 */
async function importTfvcToGit(org, project, repoId, tfvcPath, pat, importHistory = true, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/importRequests?api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat, {
        method: 'POST',
        body: JSON.stringify({
            parameters: {
                tfvcSource: {
                    path: tfvcPath,
                    importHistory,
                    importHistoryDurationInDays: importHistory ? 180 : 0
                }
            }
        })
    });
    return {
        importRequestId: data.importRequestId,
        status: data.status?.toString() || 'queued'
    };
}

/**
 * Poll TFVC-to-Git import status
 */
async function getImportStatus(org, project, repoId, importRequestId, pat, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/importRequests/${encodeURIComponent(importRequestId)}?api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return {
        importRequestId: data.importRequestId,
        status: data.status?.toString() || 'unknown',
        detailedStatus: data.detailedStatus || null
    };
}

/**
 * Delete a Git repository in Azure DevOps (cleanup temp repo after TFVC import)
 */
async function deleteGitRepo(org, project, repoId, pat, host = DEFAULT_HOST) {
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}?api-version=${API_VERSION}`;
    const res = await azureRawFetch(url, {
        method: 'DELETE',
        headers: getHeaders(pat)
    });
    if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Failed to delete repo: ${res.status}`);
    }
}

/**
 * Download TFVC items as ZIP (fallback for snapshot migration without history)
 */
async function downloadTfvcItems(org, project, scopePath, pat, host = DEFAULT_HOST) {
    const path = scopePath || `$/${project}`;
    const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/tfvc/items?scopePath=${encodeURIComponent(path)}&recursionLevel=Full&download=true&api-version=${API_VERSION}`;
    // Snapshot ZIPs can be large; allow a much longer ceiling than the default
    // and don't retry (re-downloading a multi-MB body on a blip is wasteful).
    const res = await azureRawFetch(url, {
        headers: {
            ...getHeaders(pat),
            'Accept': 'application/zip'
        }
    }, { timeoutMs: 600_000 });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Failed to download TFVC items: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Escapes single quotes in a WIQL value to prevent injection.
 */
function escapeWiql(value) {
    return value.replace(/'/g, "''");
}

/**
 * Fetch with Bearer token (for OAuth access tokens against VSSPS APIs).
 * OAuth tokens require Bearer auth, unlike PATs which use Basic auth.
 */
async function bearerFetch(url, token) {
    const res = await azureRawFetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    }, { retry: true });

    if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body?.message || `Azure API error: ${res.status} ${res.statusText}`;
        const error = new Error(message);
        error.status = res.status;
        throw error;
    }

    return res.json();
}

/**
 * List organizations the authenticated user has access to (OAuth tokens only).
 * Uses the VSSPS profile + accounts API with Bearer authentication.
 * NB: VSSPS is cloud-only (no on-prem equivalent) — host parameter ignored.
 */
async function listOrganizations(token) {
    const profile = await bearerFetch(
        'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1',
        token
    );
    const memberId = profile.publicAlias || profile.id;
    if (!memberId) {
        throw new Error('Could not determine user profile ID');
    }

    const accounts = await bearerFetch(
        `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${encodeURIComponent(memberId)}&api-version=7.1`,
        token
    );
    return (accounts.value || accounts || []).map(a => ({
        accountId: a.accountId,
        accountName: a.accountName,
        accountUri: a.accountUri || ''
    }));
}

function buildAuthenticatedCloneUrl(remoteUrl, pat) {
    if (!remoteUrl || !pat) return null;
    const parsed = new URL(remoteUrl);
    return `https://${encodeURIComponent(pat)}@${parsed.host}${parsed.pathname}`;
}

/**
 * Fetch last-commit metadata for many repos in parallel.
 */
async function listRepoActivity(org, project, repos, pat, host = DEFAULT_HOST) {
    const { default: pLimit } = await import('p-limit')
    const limit = pLimit(5)
    const base = orgBaseFor(host, org)
    const entries = await Promise.all(
        repos.map((repo) =>
            limit(async () => {
                const id = repo.id
                const defaultBranch = (repo.defaultBranch || '').replace(/^refs\/heads\//, '')
                if (!id || !defaultBranch) return [id, { lastCommitDate: null, lastCommitAuthor: null }]
                try {
                    const url = `${base}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(id)}/stats/branches?name=${encodeURIComponent(defaultBranch)}&api-version=${API_VERSION}`
                    const data = await azureFetch(url, pat)
                    const entry = Array.isArray(data.value) ? data.value[0] : data
                    const committer = entry?.commit?.committer
                    return [id, {
                        lastCommitDate: committer?.date || null,
                        lastCommitAuthor: committer?.name || null,
                    }]
                } catch {
                    return [id, { lastCommitDate: null, lastCommitAuthor: null }]
                }
            })
        )
    )
    return Object.fromEntries(entries)
}

/**
 * For each repo, check if its .gitattributes on the default branch contains
 * `filter=lfs` markers. Returns { [repoId]: boolean }.
 */
async function checkLfsMarkers(org, project, repos, pat, host = DEFAULT_HOST) {
    const { default: pLimit } = await import('p-limit')
    const limit = pLimit(5)
    const base = orgBaseFor(host, org)
    const entries = await Promise.all(
        repos.map((repo) =>
            limit(async () => {
                const id = repo.id
                if (!id) return [id, false]
                try {
                    const url = `${base}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(id)}/items?path=/.gitattributes&$format=text&api-version=${API_VERSION}`
                    const res = await azureRawFetch(url, {
                        headers: {
                            Authorization: basicAuthHeader('', pat),
                            Accept: 'text/plain',
                        },
                    }, { retry: true })
                    if (!res.ok) return [id, false]
                    const body = await res.text()
                    return [id, /filter\s*=\s*lfs/.test(body)]
                } catch {
                    return [id, false]
                }
            })
        )
    )
    return Object.fromEntries(entries)
}

/** 12-month commit activity histogram for a single repo. */
async function getCommitActivity(org, project, repoId, defaultBranch, pat, months = 12, host = DEFAULT_HOST) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const branch = (defaultBranch || '').replace(/^refs\/heads\//, '') || 'main'
  const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}&searchCriteria.fromDate=${encodeURIComponent(cutoff.toISOString())}&$top=1000&api-version=${API_VERSION}`
  const data = await azureFetch(url, pat)
  const buckets = {}
  for (const c of data.value || []) {
    const d = new Date(c.author?.date || c.committer?.date)
    if (isNaN(d)) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets[key] = (buckets[key] || 0) + 1
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }))
}

/** Fetch the repository README (first matching file in root). */
async function getRepoReadme(org, project, repoId, pat, ref, host = DEFAULT_HOST) {
  const candidates = ['README.md', 'README.MD', 'Readme.md', 'readme.md', 'README.rst', 'README']
  const base = orgBaseFor(host, org)
  for (const name of candidates) {
    try {
      const versionDesc = ref ? `&versionDescriptor.version=${encodeURIComponent(ref)}` : ''
      const url = `${base}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?path=/${name}&$format=text${versionDesc}&api-version=${API_VERSION}`
      const res = await azureRawFetch(url, {
        headers: {
          Authorization: basicAuthHeader('', pat),
          Accept: 'text/plain',
        },
      }, { retry: true })
      if (res.ok) {
        const text = await res.text()
        return { name, content: text.slice(0, 4096) }
      }
    } catch { /* try next */ }
  }
  return { name: null, content: '' }
}

/** Commit count (capped) and unique contributor count over default branch. */
async function getRepoFullStats(org, project, repoId, defaultBranch, pat, host = DEFAULT_HOST) {
  const branch = (defaultBranch || '').replace(/^refs\/heads\//, '') || 'main'
  const CAP = 500
  const url = `${orgBaseFor(host, org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}&$top=${CAP}&api-version=${API_VERSION}`
  const data = await azureFetch(url, pat)
  const commits = data.value || []
  const contributors = new Set(commits.map((c) => c.author?.email || c.author?.name).filter(Boolean))
  return {
    commitCount: commits.length,
    commitCountCapped: commits.length >= CAP,
    contributorCount: contributors.size,
  }
}

export {
    validatePat,
    listProjects,
    createProject,
    detectCapabilities,
    listOrganizations,
    listRepos,
    listRepoActivity,
    checkLfsMarkers,
    getCommitActivity,
    getRepoReadme,
    getRepoFullStats,
    getRepoDetails,
    listBranches,
    buildAuthenticatedCloneUrl,
    resolvePat,
    listWikis,
    getWorkItemCounts,
    previewWorkItems,
    fetchWorkItems,
    getWikiCloneUrl,
    getProjectInfo,
    listTfvcItems,
    createGitRepo,
    importTfvcToGit,
    getImportStatus,
    deleteGitRepo,
    downloadTfvcItems,
    getTfvcFolderSize
};
