import { API_ENDPOINTS } from '../config';
import { apiCall } from '../utils/api';

/**
 * Migration-specific API call that preserves Zod validation error details.
 * apiCall returns generic error messages for 400/422 — this wrapper enriches
 * the error with field-level validation feedback from the server.
 */
async function migrationCall(url, options = {}) {
    try {
        return await apiCall(url, options);
    } catch (err) {
        // If the error has response data with validation details, enrich the message
        if (err.data?.details) {
            const { fieldErrors = {}, formErrors = [] } = err.data.details;
            const parts = [
                ...formErrors,
                ...Object.entries(fieldErrors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            ];
            if (parts.length) {
                err.message = `${err.data.error || err.message} — ${parts.join('; ')}`;
            }
        } else if (err.data?.error) {
            err.message = err.data.error;
        }
        throw err;
    }
}

export const migrationApi = {
  createPlan: (data) => migrationCall(API_ENDPOINTS.migrationPlans, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  listPlans: (page = 1) => apiCall(`${API_ENDPOINTS.migrationPlans}?page=${page}`),
  getPlan: (id) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}`),
  updatePlan: (id, data) => migrationCall(`${API_ENDPOINTS.migrationPlans}/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  deletePlan: (id) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}`, { method: 'DELETE' }),
  validatePlan: (id) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}/validate`, { method: 'POST' }),
  executePlan: (id, { azurePat, savedCredentialId } = {}) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      azurePat: azurePat || null,
      ...(savedCredentialId ? { savedCredentialId } : {}),
    })
  }),
  cancelPlan: (id) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}/cancel`, { method: 'POST' }),
  pausePlan: (id) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}/pause`, { method: 'POST' }),
  resumePlan: (id, { azurePat, savedCredentialId } = {}) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      azurePat: azurePat || null,
      ...(savedCredentialId ? { savedCredentialId } : {}),
    })
  }),
  retryTask: (id, taskId, { azurePat, savedCredentialId } = {}) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}/tasks/${taskId}/retry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      azurePat: azurePat || null,
      ...(savedCredentialId ? { savedCredentialId } : {}),
    })
  }),
  replaceRetryTask: (id, taskId, { azurePat, savedCredentialId } = {}) => migrationCall(`${API_ENDPOINTS.migrationPlans}/${id}/tasks/${taskId}/replace-retry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      azurePat: azurePat || null,
      ...(savedCredentialId ? { savedCredentialId } : {}),
    })
  }),
  analyze: (data) => migrationCall(API_ENDPOINTS.migrationAnalyze, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  getReport: (id) => apiCall(`${API_ENDPOINTS.migrationPlans}/${id}/report`),
  streamUrl: (id) => `${API_ENDPOINTS.migrationStream}/${id}`
};
