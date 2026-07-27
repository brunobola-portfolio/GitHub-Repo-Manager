/**
 * Application Configuration
 */

// API Base URL
// In production, this typically defaults to the same origin.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Mock Mode
// Controls whether the app uses simulated data or real backend APIs.
// Default: false. Set VITE_MOCK_MODE=true in a DEV/test run to opt into demo
// data. Mock data generators live in src/__mocks__/.
//
// The `import.meta.env.DEV &&` half is load-bearing and must not be dropped.
// Without it a production build made with VITE_MOCK_MODE=true still takes
// every mock branch that is NOT itself dev-gated — App.jsx POSTs /api/auth/mock
// and fabricates a session, api/repos.js returns `committed: true` for writes
// that never happened. The __mocks__ fixtures are separately dev-gated so they
// would not ship, but the control flow above them would, which is worse: a
// deployment that lies about having written to a real repository.
// Vite statically replaces both operands, so this whole expression folds to
// `false` at build time and every guarded branch is eliminated.
export const MOCK_MODE = import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true';

// API Base Path (used by hooks that build URLs manually)
export const API_BASE = API_BASE_URL + '/api';

// Authentication Endpoints
export const AUTH_ENDPOINTS = {
    login: `${API_BASE_URL}/api/auth/login`,
    logout: `${API_BASE_URL}/api/auth/logout`,
};

// API Endpoints
export const API_ENDPOINTS = {
    user: `${API_BASE_URL}/api/user`,
    repos: `${API_BASE_URL}/api/repos`,
    visibility: `${API_BASE_URL}/api/visibility`,
    transfer: `${API_BASE_URL}/api/transfer`,
    checkConflicts: `${API_BASE_URL}/api/transfer/check-conflicts`,
    mirror: `${API_BASE_URL}/api/mirror`,
    archive: `${API_BASE_URL}/api/archive`,
    delete: `${API_BASE_URL}/api/delete`,
    migrationPlans: `${API_BASE_URL}/api/migration/plans`,
    migrationStream: `${API_BASE_URL}/api/migration/stream`,
    migrationAnalyze: `${API_BASE_URL}/api/migration/analyze`,
    azureWikis: `${API_BASE_URL}/api/azure/wikis`,
    azureWorkItemCounts: `${API_BASE_URL}/api/azure/work-items/counts`,
    azureWorkItemPreview: `${API_BASE_URL}/api/azure/work-items/preview`,
};

// Pagination Settings
export const PAGINATION = {
    defaultPerPage: 30,
    perPageOptions: [10, 30, 50, 100],
};
