import { apiCall } from '../utils/api';

export const reposApi = {
  syncMirror: async (owner, repo) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/sync`, {
      method: 'POST',
    })
  },

  getSecurityScan: async (owner, repo) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/security`)
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
}
