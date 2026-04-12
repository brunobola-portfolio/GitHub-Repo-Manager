export const reposApi = {
  exportMetadata: async (owner, repo) => {
    const res = await fetch(`/api/v1/repos/${owner}/${repo}/export`, {
      method: 'GET',
      credentials: 'include'
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const error = new Error(body.error || `HTTP ${res.status}`)
      error.status = res.status
      throw error
    }
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
