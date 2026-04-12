export const repoActionsApi = {
  listWorkflows: async (owner, repo) => {
    const res = await fetch(`/api/v1/repos/${owner}/${repo}/actions/workflows`, { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  listRuns: async (owner, repo) => {
    const res = await fetch(`/api/v1/repos/${owner}/${repo}/actions/runs`, { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  triggerDispatch: async (owner, repo, workflowId, ref = 'main') => {
    const res = await fetch(`/api/v1/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  syncRuns: async (owner, repo) => {
    const res = await fetch(`/api/v1/repos/${owner}/${repo}/actions/sync`, { method: 'POST', credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
}
