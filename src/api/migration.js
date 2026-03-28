import { API_ENDPOINTS } from '../config';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    // Include validation details in the error if present
    let msg = err.error || err.message || `HTTP ${res.status}`;
    if (err.details) {
      const fieldErrors = err.details.fieldErrors || {};
      const formErrors = err.details.formErrors || [];
      const parts = [
        ...formErrors,
        ...Object.entries(fieldErrors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      ];
      if (parts.length) msg += ` — ${parts.join('; ')}`;
      console.error('[API] Validation details:', JSON.stringify(err.details, null, 2));
    }
    throw new Error(msg);
  }
  return res.json();
}

export const migrationApi = {
  createPlan: (data) => fetchJson(API_ENDPOINTS.migrationPlans, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  listPlans: (page = 1) => fetchJson(`${API_ENDPOINTS.migrationPlans}?page=${page}`),
  getPlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}`),
  updatePlan: (id, data) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  deletePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}`, { method: 'DELETE' }),
  validatePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/validate`, { method: 'POST' }),
  executePlan: (id, { azurePat } = {}) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ azurePat: azurePat || null })
  }),
  cancelPlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/cancel`, { method: 'POST' }),
  pausePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/pause`, { method: 'POST' }),
  resumePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/resume`, { method: 'POST' }),
  retryTask: (id, taskId) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/tasks/${taskId}/retry`, { method: 'POST' }),
  analyze: (data) => fetchJson(API_ENDPOINTS.migrationAnalyze, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  getReport: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/report`),
  streamUrl: (id) => `${API_ENDPOINTS.migrationStream}/${id}`
};
