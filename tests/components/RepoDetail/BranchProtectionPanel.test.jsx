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
        expect(screen.queryByText(/Couldn.t load branch protection/i)).not.toBeInTheDocument()
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
        expect(await screen.findByText(/Couldn.t load branch protection/i)).toBeInTheDocument()
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

describe('BranchProtectionPanel — inline variant', () => {
    it('renders an inline upgrade strip when variant="inline" is set and GITHUB_PRO_REQUIRED', async () => {
        const err = Object.assign(
            new Error('Branch protection requires GitHub Pro on private repositories.'),
            { status: 403, code: 'GITHUB_PRO_REQUIRED' },
        )
        const api = makeApi({ fetchBranchProtection: vi.fn().mockRejectedValue(err) })
        renderWithProviders(
            <BranchProtectionPanel api={api} branch="main" archived={false} variant="inline" />
        )

        await waitFor(() => {
            // Inline variant: NO large card heading
            expect(screen.queryByRole('heading', { name: /Branch protection requires GitHub Pro/i })).toBeNull()
        })

        // Inline variant: a short Pro-protect chip is visible
        expect(screen.getByText(/Pro to protect/i)).toBeInTheDocument()
    })

    it('renders the existing full card when variant is unset (default)', async () => {
        const err = Object.assign(
            new Error('Branch protection requires GitHub Pro on private repositories.'),
            { status: 403, code: 'GITHUB_PRO_REQUIRED' },
        )
        const api = makeApi({ fetchBranchProtection: vi.fn().mockRejectedValue(err) })
        renderWithProviders(
            <BranchProtectionPanel api={api} branch="main" archived={false} />
        )

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: /Branch protection requires GitHub Pro/i })).toBeInTheDocument()
        })
    })

    it('renders "unprotected" status in inline mode when protection is disabled', async () => {
        const api = makeApi({ fetchBranchProtection: vi.fn().mockResolvedValue({ protected: false }) })
        renderWithProviders(
            <BranchProtectionPanel api={api} branch="main" archived={false} variant="inline" />
        )

        await waitFor(() => {
            expect(screen.getByText(/unprotected/i)).toBeInTheDocument()
        })
        // Card-mode button should NOT appear
        expect(screen.queryByRole('button', { name: /enable protection/i })).not.toBeInTheDocument()
    })

    it('renders "protected" status in inline mode when protection is enabled', async () => {
        const api = makeApi({
            fetchBranchProtection: vi.fn().mockResolvedValue({
                protected: true,
                required_pull_request_reviews: {
                    required_approving_review_count: 1,
                    dismiss_stale_reviews: false,
                    require_code_owner_reviews: false,
                },
            }),
        })
        renderWithProviders(
            <BranchProtectionPanel api={api} branch="main" archived={false} variant="inline" />
        )

        await waitFor(() => {
            expect(screen.getByText(/protected/i)).toBeInTheDocument()
        })
    })

    it('renders loading state in inline mode during fetch', async () => {
        const api = makeApi({
            fetchBranchProtection: vi.fn(() => new Promise(() => {})), // Never resolves
        })
        renderWithProviders(
            <BranchProtectionPanel api={api} branch="main" archived={false} variant="inline" />
        )

        expect(screen.getByText(/Checking protection/i)).toBeInTheDocument()
    })
})

describe('BranchProtectionPanel — permission-denied state', () => {
    it('renders the inline "admin access required" card when API returns INSUFFICIENT_PERMISSIONS', async () => {
        const err = Object.assign(
            new Error('Admin access on this repository is required to view branch protection.'),
            { status: 403, code: 'INSUFFICIENT_PERMISSIONS' },
        )
        const api = makeApi({ fetchBranchProtection: vi.fn().mockRejectedValue(err) })
        renderWithProviders(<BranchProtectionPanel api={api} branch="main" archived={false} />)

        await waitFor(() =>
            expect(screen.getByRole('heading', { name: /admin access required/i })).toBeInTheDocument()
        )

        // Quiet failure: no toast, no upgrade card, no enable CTA.
        expect(screen.queryByText(/Couldn't load branch protection/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/requires GitHub Pro/i)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /enable protection/i })).not.toBeInTheDocument()
    })

    it('falls back to permission-denied for plain 403 even without a structured code (rollout safety)', async () => {
        // If a stale backend serves a 403 without { code }, the client must
        // still render the quiet affordance — heuristic: status === 403 && !code.
        const err = Object.assign(new Error('Forbidden'), { status: 403 })
        const api = makeApi({ fetchBranchProtection: vi.fn().mockRejectedValue(err) })
        renderWithProviders(<BranchProtectionPanel api={api} branch="main" archived={false} />)

        await waitFor(() =>
            expect(screen.getByRole('heading', { name: /admin access required/i })).toBeInTheDocument()
        )
        expect(screen.queryByText(/Couldn't load branch protection/i)).not.toBeInTheDocument()
    })

    it('renders an "admin only" chip in inline variant when INSUFFICIENT_PERMISSIONS', async () => {
        const err = Object.assign(
            new Error('Admin access on this repository is required to view branch protection.'),
            { status: 403, code: 'INSUFFICIENT_PERMISSIONS' },
        )
        const api = makeApi({ fetchBranchProtection: vi.fn().mockRejectedValue(err) })
        renderWithProviders(
            <BranchProtectionPanel api={api} branch="main" archived={false} variant="inline" />
        )

        await waitFor(() => {
            expect(screen.getByText(/admin only/i)).toBeInTheDocument()
        })
        // Heading-form card must not appear in inline mode.
        expect(screen.queryByRole('heading', { name: /admin access required/i })).toBeNull()
    })
})
