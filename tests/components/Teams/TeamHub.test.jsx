/*
 * TeamHub load-error vs. empty-state guard.
 *
 * A failed `listTeams()` used to fall through to the "No teams yet — create
 * your first team" CTA, hiding the fact that the request broke. These tests
 * pin the distinction: a real load failure shows an error + Retry, while a
 * genuinely empty (successful) response shows the create CTA.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/api/teams', () => ({ listTeams: vi.fn() }))

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        motion: new Proxy(actual.motion, {
            get(target, key) {
                if (typeof key === 'string' && !['div', 'a', 'button', 'span', 'p', 'img', 'section', 'h1', 'h2', 'h3'].includes(key)) {
                    return target[key] ?? target.div
                }
                return target[key]
            },
        }),
        AnimatePresence: ({ children }) => children,
    }
})

const { TeamHub } = await import('@/components/Teams/TeamHub')
const { listTeams } = await import('@/api/teams')
const { _resetCsrfTokenForTests } = await import('@/utils/api')

function csrfTokenResponse(token) {
    return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ token }),
    }
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('TeamHub — load error vs empty', () => {
    it('shows an error + Retry (not the "No teams yet" CTA) when loading fails', async () => {
        listTeams.mockResolvedValue({ teams: [], upgradeRequired: false, error: 'HTTP 500' })
        render(<TeamHub onTeamSelect={() => {}} />)
        expect(await screen.findByText(/couldn't load teams/i, {}, { timeout: 5000 })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
        expect(screen.queryByText(/no teams yet/i)).not.toBeInTheDocument()
    })

    it('shows the create CTA when the account is genuinely empty', async () => {
        listTeams.mockResolvedValue({ teams: [], upgradeRequired: false, error: null })
        render(<TeamHub onTeamSelect={() => {}} />)
        expect(await screen.findByText(/no teams yet/i, {}, { timeout: 5000 })).toBeInTheDocument()
        expect(screen.queryByText(/couldn't load teams/i)).not.toBeInTheDocument()
    })

    it('retries loading when Retry is clicked', async () => {
        listTeams
            .mockResolvedValueOnce({ teams: [], upgradeRequired: false, error: 'HTTP 500' })
            .mockResolvedValueOnce({ teams: [], upgradeRequired: false, error: null })
        render(<TeamHub onTeamSelect={() => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: /retry/i }, { timeout: 5000 }))
        expect(await screen.findByText(/no teams yet/i, {}, { timeout: 5000 })).toBeInTheDocument()
        expect(listTeams).toHaveBeenCalledTimes(2)
    })

    // ---------------------------------------------------------------------------
    // Layout — Team Hub is a primary-nav sibling of Dashboard/Repos and must
    // span the same --layout-max-w shell instead of clamping to a narrower
    // reading column (see PageShell docs).
    // ---------------------------------------------------------------------------

    it('root PageShell spans the app shell width (no max-w-7xl cap)', async () => {
        listTeams.mockResolvedValue({ teams: [], upgradeRequired: false, error: null })
        const { container } = render(<TeamHub onTeamSelect={() => {}} />)
        await screen.findByText(/no teams yet/i, {}, { timeout: 5000 })
        expect(container.firstChild.className).toContain('max-w-none')
        expect(container.firstChild.className).not.toMatch(/max-w-(3xl|4xl|5xl|6xl|7xl)\b/)
    })
})

// ---------------------------------------------------------------------------
// Team create — routed through apiCall/fetchWithRetry (FE-01/FE-02). A 403
// csrf_invalid on the POST must invalidate the cached token, fetch a fresh
// one, and retry the mutation exactly once — the whole point of migrating
// this hand-rolled fetch off raw fetch().
// ---------------------------------------------------------------------------
describe('TeamHub — create team retries a rotated CSRF token', () => {
    let fetchMock

    beforeEach(() => {
        listTeams.mockResolvedValue({ teams: [], upgradeRequired: false, error: null })
        fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        _resetCsrfTokenForTests()
    })

    it('retries the POST once after a csrf_invalid 403 and succeeds with the fresh token', async () => {
        const user = userEvent.setup()
        fetchMock
            // 1. initial CSRF token fetch
            .mockResolvedValueOnce(csrfTokenResponse('stale-token'))
            // 2. POST /api/teams with the stale token — server rejects it
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: async () => ({ error: 'Invalid CSRF token', code: 'csrf_invalid' }),
            })
            // 3. fetchWithRetry invalidates the cache and re-fetches a fresh token
            .mockResolvedValueOnce(csrfTokenResponse('fresh-token'))
            // 4. POST retried with the fresh token — succeeds
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({ id: 1, name: 'Platform', description: '' }),
            })

        render(<TeamHub onTeamSelect={() => {}} />)

        fireEvent.click(await screen.findByRole('button', { name: 'Create team' }, { timeout: 5000 }))
        await user.type(screen.getByLabelText(/team name/i), 'Platform')

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Create Team' }))
        })

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

        const [staleCall, freshCall] = [fetchMock.mock.calls[1], fetchMock.mock.calls[3]]
        expect(staleCall[0]).toBe('/api/teams')
        expect(staleCall[1].headers['X-CSRF-Token']).toBe('stale-token')
        expect(freshCall[0]).toBe('/api/teams')
        expect(freshCall[1].headers['X-CSRF-Token']).toBe('fresh-token')

        // The form closes and fetchTeams() re-runs on success — no leftover
        // "Couldn't load teams" / raw-error state from the rejected first attempt.
        expect(screen.queryByLabelText(/team name/i)).not.toBeInTheDocument()
    })
})
