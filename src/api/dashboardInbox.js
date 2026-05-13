import { API_BASE_URL } from '../config';

const BASE = `${API_BASE_URL}/api/v1/dashboard`;

const MOCK_MODE = import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true';

// In-memory mock state. The optimistic UI in `useInbox` removes rows
// immediately on archive/snooze, but a subsequent `refresh()` re-reads from
// here — so we honour the writes locally to keep the demo coherent.
const mockArchivedIds = new Set();
const mockSnoozedIds = new Set();

function mockSeed() {
    const now = Date.now();
    return [
        {
            key: 'needs_review',
            items: [
                {
                    id: 'mock-inbox-review-1',
                    title: 'PR #142 awaiting your review',
                    kind: 'review_request',
                    repoFullName: 'acme/backend',
                    authorLogin: 'octocat',
                    since: new Date(now - 2 * 3_600_000).toISOString(),
                },
                {
                    id: 'mock-inbox-review-2',
                    title: 'PR #98 — Add OAuth refresh-token flow',
                    kind: 'review_request',
                    repoFullName: 'acme/auth',
                    authorLogin: 'octocat',
                    since: new Date(now - 5 * 3_600_000).toISOString(),
                },
            ],
        },
        {
            key: 'my_prs',
            items: [
                {
                    id: 'mock-inbox-mypr-1',
                    title: 'Your PR #210 — Refactor migration engine',
                    kind: 'my_pr',
                    repoFullName: 'acme/backend',
                    since: new Date(now - 24 * 3_600_000).toISOString(),
                },
            ],
        },
    ];
}

function mockFetchInbox() {
    const filtered = mockSeed().map(section => ({
        ...section,
        items: section.items.filter(
            i => !mockArchivedIds.has(i.id) && !mockSnoozedIds.has(i.id),
        ),
    }));
    return Promise.resolve({ sections: filtered });
}

async function jsonFetch(url, init = {}) {
    const res = await fetch(url, { credentials: 'include', ...init });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
    }
    return res.json();
}

export function fetchInbox({ sections, includeArchived = false, signal } = {}) {
    if (MOCK_MODE) return mockFetchInbox();
    const params = new URLSearchParams();
    if (sections?.length) params.set('sections', sections.join(','));
    if (includeArchived) params.set('include_archived', '1');
    const qs = params.toString();
    return jsonFetch(`${BASE}/inbox${qs ? `?${qs}` : ''}`, { signal });
}

export function archiveInboxItem(itemId) {
    if (MOCK_MODE) {
        mockArchivedIds.add(itemId);
        return Promise.resolve({ ok: true });
    }
    return jsonFetch(`${BASE}/inbox/${encodeURIComponent(itemId)}/archive`, { method: 'POST' });
}

export function restoreInboxItem(itemId) {
    if (MOCK_MODE) {
        mockArchivedIds.delete(itemId);
        mockSnoozedIds.delete(itemId);
        return Promise.resolve({ ok: true });
    }
    return jsonFetch(`${BASE}/inbox/${encodeURIComponent(itemId)}/restore`, { method: 'POST' });
}

export function snoozeInboxItem(itemId, untilIso) {
    if (MOCK_MODE) {
        mockSnoozedIds.add(itemId);
        return Promise.resolve({ ok: true });
    }
    return jsonFetch(`${BASE}/inbox/${encodeURIComponent(itemId)}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: untilIso }),
    });
}
