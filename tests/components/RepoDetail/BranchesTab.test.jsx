import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BranchesTab } from '@/components/RepoDetail/BranchesTab'
import { renderWithProviders } from '../../helpers/render-with-providers'

// BranchProtectionPanel hits localStorage / fetch — mock it to a passive component.
vi.mock('@/components/RepoDetail/BranchProtectionPanel', () => ({
    BranchProtectionPanel: ({ variant, branch }) => (
        <span data-testid={`bpp-${variant ?? 'card'}-${branch}`}>{variant === 'inline' ? '⚠ Pro to protect' : 'card'}</span>
    ),
}))
vi.mock('@/components/RepoDetail/BranchHygieneCard', () => ({
    BranchHygieneCard: () => null,
}))

const sampleBranches = [
    { name: 'main', commit: { sha: 'abc1234deadbeef' }, protected: true },
    { name: 'feature/widget', commit: { sha: 'def5678deadbeef' }, protected: false }
]

function makeApi(overrides = {}) {
    return {
        fetchBranches: vi.fn().mockResolvedValue({ data: sampleBranches }),
        createBranch: vi.fn().mockResolvedValue({ ref: 'refs/heads/new-branch' }),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        ...overrides
    }
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('BranchesTab — toast feedback', () => {
    it('fires a success toast when a branch is created', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(<BranchesTab api={api} />)

        await waitFor(() =>
            expect(screen.getByText(/2 Branches/)).toBeInTheDocument()
        )

        await user.click(screen.getByRole('button', { name: /New Branch/i }))
        await user.type(screen.getByPlaceholderText('feature/my-branch'), 'feature/new')
        await user.click(screen.getByRole('button', { name: /^Create$/i }))

        await waitFor(() =>
            expect(api.createBranch).toHaveBeenCalledWith('feature/new', 'abc1234deadbeef')
        )
        // Toast visible in the <ToastContainer>
        expect(await screen.findByText('Branch created')).toBeInTheDocument()
    })
})

// ── New tests for search / sort / filter ──────────────────────────────────────

const BRANCHES = [
    { name: 'main', commit: { sha: 'aaaaaaa1234567', author: { date: '2026-05-08T10:00:00Z' } }, protected: true },
    { name: 'feat/active', commit: { sha: 'bbbbbbb1234567', author: { date: '2026-05-07T10:00:00Z' } }, protected: false },
    { name: 'old/stale-branch', commit: { sha: 'cccccccc234567', author: { date: '2025-01-01T10:00:00Z' } }, protected: false },
]

const repoData = { default_branch: 'main', archived: false }

describe('BranchesTab — search / sort / filter', () => {
    let api

    beforeEach(() => {
        api = {
            fetchBranches: vi.fn().mockResolvedValue(BRANCHES),
            fetchBranchProtection: vi.fn().mockResolvedValue({ protected: false }),
            createBranch: vi.fn(),
            deleteBranch: vi.fn(),
        }
    })

    it('filters by search term', async () => {
        renderWithProviders(<BranchesTab api={api} repoData={repoData} />)
        await waitFor(() => screen.getByText('feat/active'))
        fireEvent.change(screen.getByPlaceholderText(/search branches/i), { target: { value: 'feat' } })
        expect(screen.queryByText('old/stale-branch')).toBeNull()
        expect(screen.getByText('feat/active')).toBeInTheDocument()
    })

    it('Stale chip narrows to branches with no commits in 90+ days', async () => {
        renderWithProviders(<BranchesTab api={api} repoData={repoData} />)
        await waitFor(() => screen.getByText('old/stale-branch'))
        fireEvent.click(screen.getByRole('button', { name: /^Stale$/ }))
        expect(screen.getByText('old/stale-branch')).toBeInTheDocument()
        expect(screen.queryByText('feat/active')).toBeNull()
    })

    it('pins the default branch at the top regardless of sort', async () => {
        renderWithProviders(<BranchesTab api={api} repoData={repoData} />)
        await waitFor(() => screen.getByText('main'))
        const rows = screen.getAllByRole('listitem')
        // The first listitem should contain "main"
        expect(rows[0].textContent).toContain('main')
    })
})
