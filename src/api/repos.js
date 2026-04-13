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
  }
}
