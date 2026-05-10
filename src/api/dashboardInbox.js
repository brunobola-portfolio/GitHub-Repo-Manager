import { API_BASE_URL } from '../config';

const BASE = `${API_BASE_URL}/api/v1/dashboard`;

async function jsonFetch(url, init = {}) {
    const res = await fetch(url, { credentials: 'include', ...init });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
    }
    return res.json();
}

export function fetchInbox({ sections, includeArchived = false, signal } = {}) {
    const params = new URLSearchParams();
    if (sections?.length) params.set('sections', sections.join(','));
    if (includeArchived) params.set('include_archived', '1');
    const qs = params.toString();
    return jsonFetch(`${BASE}/inbox${qs ? `?${qs}` : ''}`, { signal });
}

export function archiveInboxItem(itemId) {
    return jsonFetch(`${BASE}/inbox/${encodeURIComponent(itemId)}/archive`, { method: 'POST' });
}

export function restoreInboxItem(itemId) {
    return jsonFetch(`${BASE}/inbox/${encodeURIComponent(itemId)}/restore`, { method: 'POST' });
}

export function snoozeInboxItem(itemId, untilIso) {
    return jsonFetch(`${BASE}/inbox/${encodeURIComponent(itemId)}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: untilIso }),
    });
}
