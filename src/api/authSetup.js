import { API_BASE_URL } from '../config';
import { apiCall } from '../utils/api';

const BASE = `${API_BASE_URL}/api/auth`;

/**
 * First-run GitHub OAuth setup status.
 * @returns {Promise<{oauthConfigured: boolean, setupDisabled: boolean, canConfigure: boolean, homepageUrl: string, callbackUrl: string}>}
 */
export function getAuthSetupStatus() {
    return apiCall(`${BASE}/setup-status`);
}

/**
 * Persist GitHub OAuth credentials through the guided in-app setup.
 * Server enforces: unconfigured-only, loopback-only, CSRF, rate limit.
 * @param {{clientId: string, clientSecret: string}} payload
 * @returns {Promise<{success: boolean, callbackUrl: string}>}
 */
export function submitOAuthSetup({ clientId, clientSecret }) {
    return apiCall(`${BASE}/setup-oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
    });
}
