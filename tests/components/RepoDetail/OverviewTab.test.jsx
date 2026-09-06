import { screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OverviewTab } from '@/components/RepoDetail/OverviewTab'
import { renderWithProviders } from '../../helpers/render-with-providers'

// Mock useModal to avoid provider requirements
vi.mock('@/hooks/useModal', () => ({
    useModal: () => ({ openModalWithData: vi.fn() })
}))

const REPO = {
    name: 'demo',
    owner: { login: 'octocat' },
    default_branch: 'main',
    description: '',
    homepage: '',
    archived: false,
}

const mockUseResilientFetch = vi.fn()
vi.mock('@/hooks/useResilientFetch', () => ({
    useResilientFetch: (...args) => mockUseResilientFetch(...args),
}))

function mockReadme(content, overrides = {}) {
    mockUseResilientFetch.mockReturnValue({
        data: { content: btoa(content) },
        loading: false,
        error: null,
        stale: false,
        fetchedAt: null,
        reload: vi.fn(),
        ...overrides,
    })
}

function makeApi() {
    return { updateRepo: vi.fn() }
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('OverviewTab — README rendering', () => {
    it('fetches the README via the resilient read-through hook, not a bespoke api call', async () => {
        mockReadme('| h | i |\n|---|---|\n| 1 | 2 |')
        renderWithProviders(<OverviewTab api={makeApi()} repoData={REPO} onUpdate={() => {}} />)

        expect(mockUseResilientFetch).toHaveBeenCalledWith('/api/v1/repos/octocat/demo/readme')
        await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
        expect(screen.queryByText('| h | i |')).toBeNull() // raw pipe text must NOT be visible
    })

    it('shows a StaleDataBadge with a retry action when the server served cached data', async () => {
        const reload = vi.fn()
        mockReadme('# Hello', { stale: true, fetchedAt: '2026-07-17 12:00:00', reload })
        renderWithProviders(<OverviewTab api={makeApi()} repoData={REPO} onUpdate={() => {}} />)

        expect(await screen.findByTestId('stale-data-badge')).toBeInTheDocument()
    })

    it('does not show a StaleDataBadge for a fresh (non-stale) read', async () => {
        mockReadme('# Hello')
        renderWithProviders(<OverviewTab api={makeApi()} repoData={REPO} onUpdate={() => {}} />)

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument())
        expect(screen.queryByTestId('stale-data-badge')).toBeNull()
    })
})

describe('OverviewTab — README error states', () => {
    it('shows a friendly re-auth message on 401/403, not the raw server error', () => {
        const err = new Error('Session expired')
        err.status = 401
        mockUseResilientFetch.mockReturnValue({
            data: null, loading: false, error: err, stale: false, fetchedAt: null, reload: vi.fn(),
        })
        renderWithProviders(<OverviewTab api={makeApi()} repoData={REPO} onUpdate={() => {}} />)

        // .env.test pins VITE_MOCK_MODE=true, and in demo mode TabLoadError says the
        // surface is not simulated instead of asking for a sign-in; both are the
        // friendly message this test exists to assert, never the raw error.
        expect(screen.getByText(/Sign in again to view this README|Not simulated in demo mode/i)).toBeInTheDocument()
        expect(screen.queryByText('Session expired')).toBeNull()
    })
})

describe('OverviewTab — Topics', () => {
    it('renders each topic as a brand-toned ringed Badge (unified with the RepoDetail header pills)', async () => {
        mockReadme('')
        const repoWithTopics = { ...REPO, topics: ['react', 'vite'] }
        renderWithProviders(<OverviewTab api={makeApi()} repoData={repoWithTopics} onUpdate={() => {}} />)

        const pill = await screen.findByText('react')
        // Badge's brand tone (see src/components/ui/Badge.jsx TONES.brand) +
        // the `ring` prop's tone-matched inset ring (RINGS.brand).
        expect(pill.className).toMatch(/bg-brand-100/)
        expect(pill.className).toMatch(/dark:bg-brand-900\/40/)
        expect(pill.className).toMatch(/ring-1 ring-inset/)
        expect(pill.className).toMatch(/ring-brand-200/)
        expect(screen.getByText('vite')).toBeInTheDocument()
    })
})

describe('OverviewTab — AI Insights entry row', () => {
    it('renders "View AI Insights" as the shared Button primitive, matching the tap-target guarantee of its 4 row siblings', async () => {
        mockReadme('')
        renderWithProviders(<OverviewTab api={makeApi()} repoData={REPO} onUpdate={() => {}} />)

        const insightsButton = await screen.findByRole('button', { name: /view ai insights/i })
        const readmeStudioButton = screen.getByRole('button', { name: /readme studio/i })
        // Button's primitive enforces min-h-[44px]/min-w-[44px] for every
        // size except the explicit 'xs' opt-out — both buttons must carry it.
        expect(insightsButton.className).toMatch(/min-h-\[44px\]/)
        expect(readmeStudioButton.className).toMatch(/min-h-\[44px\]/)
    })
})
