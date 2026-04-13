import { apiCall } from '../utils/api';

export const repoActionsApi = {
  listWorkflows: async (owner, repo) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/actions/workflows`)
  },
  listRuns: async (owner, repo) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/actions/runs`)
  },
  triggerDispatch: async (owner, repo, workflowId, ref = 'main') => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref })
    })
  },
  syncRuns: async (owner, repo) => {
    return apiCall(`/api/v1/repos/${owner}/${repo}/actions/sync`, { method: 'POST' })
  }
}
