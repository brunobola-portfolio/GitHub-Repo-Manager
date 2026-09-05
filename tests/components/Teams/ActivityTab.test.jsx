/*
 * ActivityTab honesty guard.
 *
 * The team activity feed used to silently substitute fabricated demo events
 * (MOCK_ACTIVITY_DATA) whenever the real endpoint failed or returned non-ok,
 * so production users could read invented activity as genuine. These tests
 * pin the honest behaviour: a real (non-mock) session shows an error + Retry
 * on failure, never the demo actors, and the empty state is reserved for a
 * genuinely empty (but successful) response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Force the real-session code path (MOCK_MODE gates the intentional demo feed).
vi.mock('@/config', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, MOCK_MODE: false }
})

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        motion: new Proxy(actual.motion, {
            get(target, key) {
                if (typeof key === 'string' && !['div', 'a', 'button', 'span', 'p', 'img', 'section'].includes(key)) {
                    return target[key] ?? target.div
                }
                return target[key]
            },
        }),
        AnimatePresence: ({ children }) => children,
    }
})

const { ActivityTab } = await import('@/components/Teams/ActivityTab')

beforeEach(() => {
    vi.clearAllMocks()
})

describe('ActivityTab — honest error handling', () => {
    it('shows an error + Retry (not fabricated demo data) when the feed fails', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
        render(<ActivityTab teamId={1} />)
        expect(await screen.findByText(/couldn't load activity/i, {}, { timeout: 5000 })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
        // The demo actors must never leak into a real session.
        expect(screen.queryByText(/mock-user/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/dev-lead/i)).not.toBeInTheDocument()
    })

    it('retries the fetch when Retry is clicked and then renders the empty state on success', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
            .mockResolvedValueOnce({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ events: [], totalRepos: 0, scannedRepos: 0, truncated: false }) })
        global.fetch = fetchMock
        render(<ActivityTab teamId={1} />)
        fireEvent.click(await screen.findByRole('button', { name: /retry/i }, { timeout: 5000 }))
        expect(await screen.findByText(/no recent activity/i, {}, { timeout: 5000 })).toBeInTheDocument()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('renders real events returned by the feed', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/json' }, json: async () => ({
                events: [{
                    id: 'e1',
                    type: 'PushEvent',
                    created_at: '2026-01-02T10:00:00Z',
                    actor: { login: 'realdev', avatar_url: '' },
                    repo_name: 'acme/api',
                    payload: { size: 2 },
                }],
                totalRepos: 1,
                scannedRepos: 1,
                truncated: false,
            }),
        })
        render(<ActivityTab teamId={1} />)
        expect(await screen.findByText(/realdev/i, {}, { timeout: 5000 })).toBeInTheDocument()
    })
})
