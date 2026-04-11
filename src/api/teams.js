/**
 * Teams API client
 *
 * Wraps `/api/teams` with three concerns the raw `fetch` calls didn't handle:
 *
 * 1. **Mock mode** — in demo mode (`VITE_MOCK_MODE !== 'false'`) we never
 *    hit the network. Before this helper, `App.jsx` fired a background
 *    `GET /api/teams` on mount, which was proxied to the real backend.
 *    The backend gates teams behind `requireTier('pro')`, so the call
 *    returned `403 upgrade_required`. The JS caught the error but the
 *    browser still logged "Failed to load resource" — confusing noise
 *    in a demo that's otherwise fully self-contained.
 *
 * 2. **Free-tier upgrade gate** — `requireTier('pro')` is applied at the
 *    `/teams` mount point on the backend. Free users hitting `GET` get
 *    a 403 with `{ error: 'upgrade_required', ... }`. That's *not* an
 *    error from the user's perspective — it's an upsell signal. We treat
 *    it as "empty list, upgrade needed" so callers can show a CTA instead
 *    of a `toast.error('Could not load teams')`.
 *
 * 3. **Shape consistency** — always returns `{ teams, upgradeRequired, error }`
 *    so callers can destructure predictably regardless of outcome. The
 *    `teams` array is guaranteed to exist.
 */
import { API_BASE_URL, MOCK_MODE } from '../config'

const REPO_MANAGER_API = `${API_BASE_URL}/api`

// Seeded mock teams for demo mode. Matches the shape returned by
// `server/routes/teams.js` — id, name, description, role, member_count,
// repo_count, created_at — so the Dashboard + TeamHub views render
// without special-casing mock vs. real data.
const MOCK_TEAMS = [
    {
        id: 1,
        name: 'Frontend Guild',
        description: 'React, design system and accessibility owners.',
        role: 'owner',
        member_count: 6,
        repo_count: 12,
        created_at: '2025-11-02T09:00:00Z',
    },
    {
        id: 2,
        name: 'Platform',
        description: 'Infrastructure, CI/CD, and observability.',
        role: 'admin',
        member_count: 4,
        repo_count: 9,
        created_at: '2025-09-14T16:20:00Z',
    },
    {
        id: 3,
        name: 'Mobile',
        description: 'iOS and Android release trains.',
        role: 'member',
        member_count: 5,
        repo_count: 7,
        created_at: '2025-12-20T11:45:00Z',
    },
]

/**
 * List teams visible to the current user.
 *
 * @returns {Promise<{ teams: Array, upgradeRequired: boolean, error: string | null }>}
 */
export async function listTeams() {
    if (MOCK_MODE) {
        // Short-circuit: no network call, no console noise.
        return { teams: MOCK_TEAMS, upgradeRequired: false, error: null }
    }

    try {
        const res = await fetch(`${REPO_MANAGER_API}/teams`, {
            credentials: 'include',
        })

        // Free-tier upgrade gate. Not treated as an error — callers should
        // render an upgrade CTA instead of a failure toast.
        if (res.status === 403) {
            return { teams: [], upgradeRequired: true, error: null }
        }

        if (!res.ok) {
            return { teams: [], upgradeRequired: false, error: `HTTP ${res.status}` }
        }

        const data = await res.json()
        return {
            teams: Array.isArray(data) ? data : [],
            upgradeRequired: false,
            error: null,
        }
    } catch (e) {
        return {
            teams: [],
            upgradeRequired: false,
            error: e?.message || 'Network error',
        }
    }
}
