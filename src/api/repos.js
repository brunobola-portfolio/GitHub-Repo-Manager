export const reposApi = {
  exportMetadata: async (owner, repo) => {
    const res = await fetch(`/api/v1/repos/${owner}/${repo}/export`, {
      method: 'GET',
      credentials: 'include'
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Export failed' }))
      throw new Error(err.error || 'Export failed')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const cd = res.headers.get('content-disposition') || ''
    const match = cd.match(/filename="(.+?)"/)
    a.download = match ? match[1] : `${repo}-export.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return { filename: a.download }
  }
}
