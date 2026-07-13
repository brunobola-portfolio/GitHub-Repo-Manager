/*
 * TeamHub load-error vs. empty-state guard.
 *
 * A failed `listTeams()` used to fall through to the "No teams yet — create
 * your first team" CTA, hiding the fact that the request broke. These tests
 * pin the distinction: a real load failure shows an error + Retry, while a
 * genuinely empty (successful) response shows the create CTA.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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
