/**
 * Azure DevOps Service
 * Handles all Azure DevOps REST API interactions (API v7.1)
 * Auth: Basic auth with PAT (Personal Access Token)
 */

const BASE_URL = 'https://dev.azure.com';
const API_VERSION = '7.1';

/**
 * Resolve PAT: use provided value, or fall back to AZURE_PAT env var, or session token.
 * @param {string|undefined} pat - PAT from request body (may be undefined)
 * @param {object|undefined} session - Express session (may be undefined)
 * @returns {string|null}
 */
function resolvePat(pat, session) {
    return pat || session?.azureToken || process.env.AZURE_PAT || null;
}

function getHeaders(pat) {
    const encoded = Buffer.from(`:${pat}`).toString('base64');
    return {
        'Authorization': `Basic ${encoded}`,
        'Content-Type': 'application/json'
    };
}

async function azureFetch(url, pat, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            ...getHeaders(pat),
            ...options.headers
        }
    });

    if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body?.message || `Azure DevOps API error: ${res.status} ${res.statusText}`;
        const error = new Error(message);
        error.status = res.status;
        throw error;
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

function buildAuthenticatedCloneUrl(remoteUrl, pat) {
    if (!remoteUrl || !pat) return null;
    // Azure DevOps URLs: https://dev.azure.com/org/project/_git/repo
    // Embed PAT: https://pat@dev.azure.com/org/project/_git/repo
    return remoteUrl.replace('https://', `https://${encodeURIComponent(pat)}@`);
}

export {
    validatePat,
    listProjects,
    listRepos,
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
