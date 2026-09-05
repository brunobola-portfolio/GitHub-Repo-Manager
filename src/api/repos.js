import { apiCall } from '../utils/api';
import { MOCK_MODE } from '../config';

/**
 * Commit (or open a PR for) a single repo file through the shared
 * community-health/commit-fix write path — used by README Studio, Community
 * Health fixes and (via the same server route family) other generated-file
 * writes. Centralises the CSRF + error-shaping logic these callers duplicated,
 * and short-circuits in demo mode with an honest simulated success (the global
 * "Demo mode — simulated" banner is the context) instead of a real 403/CSRF
 * failure the visitor would read as a broken feature.
 *
 * `fileType` (not `filePath`) selects the destination — the server derives
 * the canonical path from its own FILE_GENERATORS registry (2026-07-19
 * hardening: the client no longer gets to name an arbitrary write path).
 *
 * @returns {Promise<{committed:boolean, mode:string, path:string, prUrl?:string}>}
 */
export async function commitCommunityHealthFix({ owner, repo, fileType, content, commitMessage, mode = 'direct' }) {
  if (MOCK_MODE) {
    return {
      committed: mode !== 'pr',
      mode,
      path: fileType,
      branch: mode === 'pr' ? 'repo-manager/readme-studio' : 'main',
      ...(mode === 'pr' ? { prUrl: `https://github.com/${owner}/${repo}/pull/1` } : {}),
    };
  }
  // apiCall's ApiError already carries .status, .code and .data (the parsed
  // body) — the same fields this used to hand-roll off the raw Response.
  return apiCall(`/api/repos/${owner}/${repo}/community-health/commit-fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileType, content, commitMessage, mode }),
  });
}

export const reposApi = {
  syncMirror: async (owner, repo) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/sync`, {
      method: 'POST',
    })
  },

  // Read-only sync preview (free on every tier). Returns the tracked mirror's
  // source/target + last-sync metadata without cloning or pushing.
  previewSync: async (owner, repo) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/sync/preview`)
  },

  getSecurityScan: async (owner, repo) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/security`)
  },

  /**
   * Cached AI summary of a repo's Security Posture report card. The client
   * submits back the SAME check results GET .../security just returned —
   * the server whitelists id/label/status/severity server-side and never
   * accepts raw alert content. Progressive enhancement only: callers should
   * treat a rejection as "AI summary unavailable", never block the report
   * card render on it.
   *
   * @param {string} owner
   * @param {string} repo
   * @param {{full_name:string, private?:boolean}} repoMeta
   * @param {Array<{id:string,label:string,status:string,severity?:string|null}>} checks
   */
  getSecurityPostureSummary: async (owner, repo, repoMeta, checks) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/security/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: repoMeta, checks }),
    })
  },

  /**
   * Fetch auto-generated CODEOWNERS suggestions derived from recent commit
   * authorship. Backed by GET /api/v1/repos/:owner/:repo/codeowners/suggest.
   *
   * @param {string} owner
   * @param {string} repo
   * @param {object} [opts]
   * @param {number} [opts.commits=100] — how many recent commits to analyse (20..200)
   * @param {number} [opts.minTouches=2] — require ≥ N touches per owner (1..N)
   * @param {number} [opts.maxOwners=3]  — cap owners per path (1..5)
   * @returns {Promise<{ found: boolean, rules: Array<{pattern:string, owners:string[]}>, preview: string, analyzedCommits: number }>}
   */
  suggestCodeowners: async (owner, repo, { commits = 100, minTouches = 2, maxOwners = 3 } = {}) => {
    const params = new URLSearchParams({
      commits: String(commits),
      minTouches: String(minTouches),
      maxOwners: String(maxOwners),
    })
    return apiCall(`/api/v1/repos/${owner}/${repo}/codeowners/suggest?${params}`)
  },

  /**
   * Fetch the contents of a specific file (README, package.json, etc.) from a
   * repo. Returns GitHub's contents response shape — the caller is responsible
   * for base64-decoding `data.content` into text.
   */
  getFileContent: async (owner, repo, path) => {
    const params = new URLSearchParams({ path })
    return apiCall(`/api/v1/repos/${owner}/${repo}/contents?${params}`)
  },

  exportMetadata: async (owner, repo) => {
    const { fetchWithRetry } = await import('../utils/api')
    const res = await fetchWithRetry(`/api/v1/repos/${owner}/${repo}/export`, {
      method: 'GET',
      credentials: 'include',
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    let filename = `${repo}-export.json`
    try {
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('content-disposition') || ''
      const match = cd.match(/filename="(.+?)"/)
      if (match) filename = match[1]
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      URL.revokeObjectURL(url)
    }
    return { filename }
  },

  /**
   * Update repo metadata (name, description, homepage, etc.).
   * Backed by PATCH /api/v1/repos/:owner/:repo.
   *
   * @param {string} owner
   * @param {string} repo
   * @param {object} payload — fields accepted by repoUpdateSchema (name, description, …)
   */
  updateRepo: async (owner, repo, payload) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },

  /**
   * Replace the GitHub topics on a repo. CSRF is injected by fetchWithRetry.
   * Backed by PUT /api/repos/:owner/:repo/topics.
   *
   * @param {string} owner
   * @param {string} repo
   * @param {string[]} names — full topic list to set on the repo
   */
  setTopics: async (owner, repo, names) => {
    return apiCall(`/api/repos/${owner}/${repo}/topics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
    })
  },

  listCollaborators: async (owner, repo) => {
    return apiCall(`/api/repos/${owner}/${repo}/collaborators`)
  },

  addCollaborator: async (owner, repo, username, permission = 'push') => {
    return apiCall(`/api/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission }),
    })
  },

  removeCollaborator: async (owner, repo, username) => {
    return apiCall(`/api/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    })
  },

  getTree: async (owner, name, branch) => {
    const qs = branch ? `?branch=${encodeURIComponent(branch)}` : '';
    return apiCall(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree${qs}`);
  },
}
