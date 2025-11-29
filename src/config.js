/**
 * Application configuration
 * Uses Vite environment variables with sensible defaults
 */

// API base URL - defaults to same origin for production
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

// Enable mock mode for development without backend
// Set VITE_MOCK_MODE=false in .env to disable mock mode
// If VITE_MOCK_MODE is not set, defaults to true (demo mode)
export const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true' || import.meta.env.VITE_MOCK_MODE === true || false

// GitHub OAuth endpoints
export const AUTH_ENDPOINTS = {
    login: `${API_BASE_URL}/api/auth/login`,
    logout: `${API_BASE_URL}/api/auth/logout`,
}

// API endpoints
export const API_ENDPOINTS = {
    user: `${API_BASE_URL}/api/user`,
    repos: `${API_BASE_URL}/api/repos`,
    visibility: `${API_BASE_URL}/api/visibility`,
    transfer: `${API_BASE_URL}/api/transfer`,
    mirror: `${API_BASE_URL}/api/mirror`,
}

// Pagination defaults
export const PAGINATION = {
    defaultPerPage: 30,
    perPageOptions: [10, 30, 50, 100],
}
