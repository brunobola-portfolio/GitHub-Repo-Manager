import { apiCall } from '../utils/api'

/**
 * Fetch the current notifications digest. Returns null on failure — the
 * caller renders the dropdown with empty totals rather than blocking the UI.
 */
export async function fetchNotificationsDigest({ signal } = {}) {
    try {
        return await apiCall('/api/notifications/digest', { signal })
    } catch {
        return null
    }
}

/**
 * Mark all notifications as seen. Resolves to true on success, false on
 * network error (caller can decide whether to retry on next focus).
 */
export async function markNotificationsSeen() {
    try {
        await apiCall('/api/notifications/mark-seen', { method: 'POST' })
        return true
    } catch {
        return false
    }
}
