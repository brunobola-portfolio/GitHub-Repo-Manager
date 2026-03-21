import { API_ENDPOINTS } from '../config';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || `HTTP ${res.status}`);
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
  executePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/execute`, { method: 'POST' }),
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
