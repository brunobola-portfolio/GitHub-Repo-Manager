/*
 * BranchProtectionPanel — branch-protection on private repos under the
 * GitHub free plan returns 403 with code GITHUB_PRO_REQUIRED. Render an
 * inline upgrade affordance and DO NOT toast — the previous UX flagged
 * this expected limitation as a transient failure.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import { BranchProtectionPanel } from '@/components/RepoDetail/BranchProtectionPanel'
import { renderWithProviders } from '../../helpers/render-with-providers'

function makeApi(overrides = {}) {
    return {
        fetchBranchProtection: vi.fn(),
        updateBranchProtection: vi.fn(),
        deleteBranchProtection: vi.fn(),
        ...overrides,
    }
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('BranchProtectionPanel — upgrade-required state', () => {
    it('renders the inline upgrade card when fetch throws GITHUB_PRO_REQUIRED', async () => {
        const err = Object.assign(
            new Error('Branch protection requires GitHub Pro on private repositories.'),
            { status: 403, code: 'GITHUB_PRO_REQUIRED' },
        )
        const api = makeApi({ fetchBranchProtection: vi.fn().mockRejectedValue(err) })
        renderWithProviders(<BranchProtectionPanel api={api} branch="main" archived={false} />)

        await waitFor(() =>
            expect(screen.getByText(/Branch protection requires GitHub Pro/i)).toBeInTheDocument()
        )

        // No toast about the failure — the inline card replaces it.
        expect(screen.queryByText(/Failed to load branch protection/i)).not.toBeInTheDocument()
        // The "Enable protection" CTA must NOT be offered (would 403 again).
        expect(screen.queryByRole('button', { name: /enable protection/i })).not.toBeInTheDocument()
        // Pricing link points outward.
        const link = screen.getByRole('link', { name: /see github plans/i })
        expect(link).toHaveAttribute('href', expect.stringContaining('github.com/pricing'))
        expect(link).toHaveAttribute('target', '_blank')
    })

    it('still surfaces a toast for unrelated 4xx/5xx (no GITHUB_PRO_REQUIRED code)', async () => {
        const err = Object.assign(new Error('boom'), { status: 500 })
        const api = makeApi({ fetchBranchProtection: vi.fn().mockRejectedValue(err) })
        renderWithProviders(<BranchProtectionPanel api={api} branch="main" archived={false} />)

        // Generic-error path: toast title appears in the DOM via ToastProvider.
        expect(await screen.findByText(/Failed to load branch protection/i)).toBeInTheDocument()
        // Upgrade card must NOT render for unrelated failures.
        expect(screen.queryByText(/requires GitHub Pro/i)).not.toBeInTheDocument()
    })

    it('renders the normal "not protected" empty state on success with no protection', async () => {
        const api = makeApi({ fetchBranchProtection: vi.fn().mockResolvedValue({ protected: false }) })
        renderWithProviders(<BranchProtectionPanel api={api} branch="main" archived={false} />)

        await waitFor(() =>
            expect(screen.getByText(/This branch is not protected/i)).toBeInTheDocument()
        )
        expect(screen.getByRole('button', { name: /enable protection/i })).toBeInTheDocument()
        expect(screen.queryByText(/requires GitHub Pro/i)).not.toBeInTheDocument()
    })
})
