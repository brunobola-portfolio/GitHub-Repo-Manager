/**
 * Azure DevOps Service
 * Handles all Azure DevOps REST API interactions (API v7.1)
 * Auth: Basic auth with PAT (Personal Access Token)
 */

import { decryptCredentials } from './lib/credential-encryption.js';

const BASE_URL = 'https://dev.azure.com';
const API_VERSION = '7.1';

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
    const encoded = Buffer.from(`:${pat}`).toString('base64');
    return {
        'Authorization': `Basic ${encoded}`,
        'Content-Type': 'application/json'
    };
}

async function azureFetch(url, pat, options = {}) {
    if (!pat) {
        throw new Error('Azure DevOps PAT is required. Configure AZURE_PAT in .env or provide a personal PAT.');
    }

    const res = await fetch(url, {
        ...options,
        headers: {
            ...getHeaders(pat),
            ...options.headers
        }
    });

    // Check content-type before parsing — Azure returns HTML on auth failures
    const contentType = res.headers.get('content-type') || '';

    if (!res.ok) {
        if (contentType.includes('text/html')) {
            throw new Error(`Azure DevOps authentication failed (HTTP ${res.status}). Check your PAT permissions.`);
        }
        const body = await res.json().catch(() => null);
        const message = body?.message || `Azure DevOps API error: ${res.status} ${res.statusText}`;
        const error = new Error(message);
        error.status = res.status;
        throw error;
    }

    if (contentType.includes('text/html')) {
        throw new Error('Azure DevOps returned HTML instead of JSON. This usually means authentication failed.');
    }

    return res.json();
}

/**
 * Validate a PAT against an Azure DevOps organization
 */
async function validatePat(org, pat) {
    if (!org || !pat) {
        return { valid: false, error: 'Organization and PAT are required' };
    }

    try {
        const url = `${BASE_URL}/${encodeURIComponent(org)}/_apis/projects?api-version=${API_VERSION}&$top=1`;
        await azureFetch(url, pat);
        return { valid: true };
    } catch (e) {
        if (e.status === 401 || e.status === 403) {
            return { valid: false, error: 'Invalid or insufficient PAT permissions' };
        }
        return { valid: false, error: e.message };
    }
}

/**
 * List projects in an Azure DevOps organization
 */
async function listProjects(org, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/_apis/projects?api-version=${API_VERSION}&$top=200`;
    const data = await azureFetch(url, pat);
    return (data.value || []).map(p => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        state: p.state,
        url: p.url,
        lastUpdateTime: p.lastUpdateTime
    }));
}

/**
 * List repositories in a project
 */
async function listRepos(org, project, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${API_VERSION}`;
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
async function getRepoDetails(org, project, repoName, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoName)}?api-version=${API_VERSION}`;
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
async function listBranches(org, project, repoId, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/refs?filter=heads/&api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return (data.value || []).map(ref => ({
        name: ref.name.replace('refs/heads/', ''),
        objectId: ref.objectId
    }));
}

/**
 * List wikis in a project
 */
async function listWikis(org, project, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wiki/wikis?api-version=${API_VERSION}`;
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
async function getWorkItemCounts(org, project, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=${API_VERSION}`;
    const wiql = `SELECT [System.Id], [System.WorkItemType] FROM workitems WHERE [System.TeamProject] = '${escapeWiql(project)}'`;
    const data = await azureFetch(url, pat, {
        method: 'POST',
        body: JSON.stringify({ query: wiql })
    });

    const ids = (data.workItems || []).map(wi => wi.id);
    if (ids.length === 0) return {};

    // Fetch work item details in batches of 200 to get their types
    const counts = {};
    for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const detailUrl = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(',')}&fields=System.WorkItemType&api-version=${API_VERSION}`;
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
async function previewWorkItems(org, project, pat, types) {
    const items = [];

    for (const type of types) {
        const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=${API_VERSION}`;
        const wiql = `SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = '${escapeWiql(project)}' AND [System.WorkItemType] = '${escapeWiql(type)}' ORDER BY [System.Id] DESC`;
        const data = await azureFetch(url, pat, {
            method: 'POST',
            body: JSON.stringify({ query: wiql, $top: 10 })
        });

        const ids = (data.workItems || []).slice(0, 10).map(wi => wi.id);
        if (ids.length === 0) continue;

        const detailUrl = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo&api-version=${API_VERSION}`;
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
async function fetchWorkItems(org, project, pat, ids) {
    if (!ids || ids.length === 0) return [];

    const results = [];
    for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=relations&api-version=${API_VERSION}`;
        const data = await azureFetch(url, pat);
        results.push(...(data.value || []));
    }

    return results;
}

/**
 * Get wiki clone URL by wiki ID
 */
async function getWikiCloneUrl(org, project, pat, wikiId) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wiki/wikis/${encodeURIComponent(wikiId)}?api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return data.remoteUrl || '';
}

/**
 * Get project info including version control type (Git or Tfvc)
 */
async function getProjectInfo(org, project, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/_apis/projects/${encodeURIComponent(project)}?includeCapabilities=true&api-version=${API_VERSION}`;
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
async function listTfvcItems(org, project, pat, scopePath) {
    const path = scopePath || `$/${project}`;
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/tfvc/items?scopePath=${encodeURIComponent(path)}&recursionLevel=OneLevel&api-version=${API_VERSION}`;
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
 * @param {string} org - Azure DevOps organization
 * @param {string} project - Project name
 * @param {string} pat - Personal Access Token
 * @param {string} scopePath - TFVC folder path (e.g. "$/Project/Folder")
 * @returns {Promise<number>} Total size in bytes
 */
async function getTfvcFolderSize(org, project, pat, scopePath) {
    const path = scopePath || `$/${project}`;
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/tfvc/items?scopePath=${encodeURIComponent(path)}&recursionLevel=Full&api-version=${API_VERSION}`;
    const data = await azureFetch(url, pat);
    return (data.value || [])
        .filter(item => !item.isFolder)
        .reduce((sum, item) => sum + (item.size || 0), 0);
}

/**
 * Create a new Git repository in Azure DevOps (used as temp target for TFVC import)
 */
async function createGitRepo(org, project, repoName, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${API_VERSION}`;
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
async function importTfvcToGit(org, project, repoId, tfvcPath, pat, importHistory = true) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/importRequests?api-version=${API_VERSION}`;
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
async function getImportStatus(org, project, repoId, importRequestId, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/importRequests/${encodeURIComponent(importRequestId)}?api-version=${API_VERSION}`;
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
async function deleteGitRepo(org, project, repoId, pat) {
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}?api-version=${API_VERSION}`;
    const res = await fetch(url, {
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
async function downloadTfvcItems(org, project, scopePath, pat) {
    const path = scopePath || `$/${project}`;
    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/tfvc/items?scopePath=${encodeURIComponent(path)}&recursionLevel=Full&download=true&api-version=${API_VERSION}`;
    const res = await fetch(url, {
        headers: {
            ...getHeaders(pat),
            'Accept': 'application/zip'
        }
    });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Failed to download TFVC items: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Escapes single quotes in a WIQL value to prevent injection.
 * @param {string} value
 * @returns {string}
 */
function escapeWiql(value) {
    return value.replace(/'/g, "''");
}

/**
 * Fetch with Bearer token (for OAuth access tokens against VSSPS APIs).
 * OAuth tokens require Bearer auth, unlike PATs which use Basic auth.
 */
async function bearerFetch(url, token) {
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

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
 */
async function listOrganizations(token) {
    // 1. Get the user's profile to retrieve memberId
    const profile = await bearerFetch(
        'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1',
        token
    );
    const memberId = profile.publicAlias || profile.id;
    if (!memberId) {
        throw new Error('Could not determine user profile ID');
    }

    // 2. List accounts (organizations) for this member
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
    // Azure DevOps URLs may contain existing userinfo (org@dev.azure.com).
    // URL.host excludes userinfo, URL.pathname keeps %20 encoding intact.
    const parsed = new URL(remoteUrl);
    return `https://${encodeURIComponent(pat)}@${parsed.host}${parsed.pathname}`;
}

/**
 * Fetch last-commit metadata for many repos in parallel.
 * Returns { [repoId]: { lastCommitDate, lastCommitAuthor } | { lastCommitDate: null, lastCommitAuthor: null } }.
 * Individual failures are swallowed (activity is a hint, not a requirement).
 */
async function listRepoActivity(org, project, repos, pat) {
    const { default: pLimit } = await import('p-limit')
    const limit = pLimit(5)
    const entries = await Promise.all(
        repos.map((repo) =>
            limit(async () => {
                const id = repo.id
                const defaultBranch = (repo.defaultBranch || '').replace(/^refs\/heads\//, '')
                if (!id || !defaultBranch) return [id, { lastCommitDate: null, lastCommitAuthor: null }]
                try {
                    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(id)}/stats/branches?name=${encodeURIComponent(defaultBranch)}&api-version=${API_VERSION}`
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
 *
 * Uses raw fetch instead of azureFetch because the Azure /items endpoint
 * returns plain text when $format=text, not JSON.
 */
async function checkLfsMarkers(org, project, repos, pat) {
    const { default: pLimit } = await import('p-limit')
    const limit = pLimit(5)
    const entries = await Promise.all(
        repos.map((repo) =>
            limit(async () => {
                const id = repo.id
                if (!id) return [id, false]
                try {
                    const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(id)}/items?path=/.gitattributes&$format=text&api-version=${API_VERSION}`
                    const res = await fetch(url, {
                        headers: {
                            Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
                            Accept: 'text/plain',
                        },
                    })
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
async function getCommitActivity(org, project, repoId, defaultBranch, pat, months = 12) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const branch = (defaultBranch || '').replace(/^refs\/heads\//, '') || 'main'
  const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}&searchCriteria.fromDate=${encodeURIComponent(cutoff.toISOString())}&$top=1000&api-version=${API_VERSION}`
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
async function getRepoReadme(org, project, repoId, pat, ref) {
  const candidates = ['README.md', 'README.MD', 'Readme.md', 'readme.md', 'README.rst', 'README']
  for (const name of candidates) {
    try {
      const versionDesc = ref ? `&versionDescriptor.version=${encodeURIComponent(ref)}` : ''
      const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?path=/${name}&$format=text${versionDesc}&api-version=${API_VERSION}`
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
          Accept: 'text/plain',
        },
      })
      if (res.ok) {
        const text = await res.text()
        return { name, content: text.slice(0, 4096) }
      }
    } catch { /* try next */ }
  }
  return { name: null, content: '' }
}

/** Commit count (capped) and unique contributor count over default branch. */
async function getRepoFullStats(org, project, repoId, defaultBranch, pat) {
  const branch = (defaultBranch || '').replace(/^refs\/heads\//, '') || 'main'
  const CAP = 500
  const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}&$top=${CAP}&api-version=${API_VERSION}`
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
