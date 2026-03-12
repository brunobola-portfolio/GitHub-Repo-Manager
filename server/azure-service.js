/**
 * Azure DevOps Service
 * Handles all Azure DevOps REST API interactions (API v7.1)
 * Auth: Basic auth with PAT (Personal Access Token)
 */

const BASE_URL = 'https://dev.azure.com';
const API_VERSION = '7.1';

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
 * Construct authenticated clone URL with embedded PAT
 */
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
    buildAuthenticatedCloneUrl
};
