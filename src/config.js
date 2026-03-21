/**
 * Application Configuration
 */

// API Base URL
// In production, this typically defaults to the same origin.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Mock Mode
// Controls whether the app uses simulated data or real backend APIs.
// Default: true (Demo Mode) unless VITE_MOCK_MODE is explicitly 'false'.
export const MOCK_MODE = import.meta.env.VITE_MOCK_MODE !== 'false';

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
};

// Pagination Settings
export const PAGINATION = {
    defaultPerPage: 30,
    perPageOptions: [10, 30, 50, 100],
};
