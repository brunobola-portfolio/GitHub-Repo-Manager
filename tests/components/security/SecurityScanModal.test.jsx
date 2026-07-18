/*
 * SecurityScanModal — "Security Posture" report card.
 *
 * Covers the honesty contract from docs/specs/2026-07-18-community-wow-wave6.md
 * (Feature 4): the deterministic 10-check report card renders fully and
 * correctly on its own, and the AI summary footer is a progressive
 * enhancement that never blocks or fails the report card render.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor, cleanup, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SecurityScanModal } from '@/components/security/SecurityScanModal'
import { renderWithProviders } from '../../helpers/render-with-providers'

vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }))
vi.mock('@/hooks/useMobileKeyboardFix', () => ({ useMobileKeyboardFix: () => {} }))

const mockGetSecurityScan = vi.fn()
const mockGetSecurityPostureSummary = vi.fn()
vi.mock('@/api/repos', () => ({
    reposApi: {
        getSecurityScan: (...a) => mockGetSecurityScan(...a),
        getSecurityPostureSummary: (...a) => mockGetSecurityPostureSummary(...a),
    },
}))

const REPO = { owner: { login: 'alice' }, name: 'hello', full_name: 'alice/hello', private: false }

function makeCheck(overrides = {}) {
    return {
        id: 'security_md',
        label: 'SECURITY.md present',
        status: 'pass',
        severity: null,
        why: 'A SECURITY.md tells researchers how to report a vulnerability responsibly.',
        ...overrides,
    }
}

const TEN_CHECKS = [
    makeCheck({ id: 'branch_protection_review', label: 'Default branch requires PR review before merge', status: 'fail', severity: 'critical' }),
    makeCheck({ id: 'branch_protection_force_push', label: 'Default branch disallows force-push and deletion', status: 'fail', severity: 'high' }),
    makeCheck({ id: 'alerts_clear', label: 'Zero open critical/high security alerts', status: 'pass' }),
    makeCheck({ id: 'secret_scanning', label: 'Secret scanning enabled', status: 'unknown' }),
    makeCheck({ id: 'secret_scanning_push_protection', label: 'Secret scanning push protection enabled', status: 'unknown' }),
    makeCheck({ id: 'dependabot_security_updates', label: 'Dependabot security updates enabled', status: 'unknown' }),
    makeCheck({ id: 'code_scanning', label: 'Code scanning configured', status: 'pass' }),
    makeCheck({ id: 'security_md', label: 'SECURITY.md present', status: 'fail', severity: 'medium' }),
    makeCheck({ id: 'workflow_permissions', label: 'Default Actions workflow token permissions are read-only', status: 'unknown' }),
    makeCheck({ id: 'org_two_factor', label: 'Organization requires two-factor authentication', status: 'not_applicable' }),
]

function baseScanResponse(overrides = {}) {
    return {
        secretScanning: { available: false, reason: 'Unavailable or insufficient token scope (security_events)' },
        codeScanning: { available: true, alerts: [] },
        dependabot: { available: false, reason: 'Unavailable or insufficient token scope (security_events)' },
        summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
        checks: TEN_CHECKS,
        score: { passing: 3, failing: 3, unknown: 3, notApplicable: 1, informational: 0, total: 10, visible: 6, score: 50, partialVisibility: true },
        ...overrides,
    }
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('SecurityScanModal — report card', () => {
    it('renamed the title to "Security Posture" and kept the testid stable', async () => {
        mockGetSecurityScan.mockResolvedValue(baseScanResponse())
        mockGetSecurityPostureSummary.mockResolvedValue({ summary: 's', topActions: [] })
        renderWithProviders(<SecurityScanModal isOpen onClose={vi.fn()} repo={REPO} />)

        expect(await screen.findByRole('heading', { name: 'Security Posture' })).toBeInTheDocument()
        expect(document.querySelector('[data-testid="security-scan-modal"]')).toBeInTheDocument()
    })

    it('renders all 10 deterministic checks with correct pass/fail/unknown/not_applicable labels', async () => {
        mockGetSecurityScan.mockResolvedValue(baseScanResponse())
        mockGetSecurityPostureSummary.mockResolvedValue({ summary: 's', topActions: [] })
        renderWithProviders(<SecurityScanModal isOpen onClose={vi.fn()} repo={REPO} />)

        const list = await screen.findByTestId('security-check-list')
        expect(within(list).getAllByTestId(/^security-check-/)).toHaveLength(10)

        const secretScanningRow = within(list).getByTestId('security-check-secret_scanning')
        expect(within(secretScanningRow).getByText(/Unknown — admin required/i)).toBeInTheDocument()

        const orgRow = within(list).getByTestId('security-check-org_two_factor')
        expect(within(orgRow).getByText(/Not applicable/i)).toBeInTheDocument()

        const branchRow = within(list).getByTestId('security-check-branch_protection_review')
        expect(within(branchRow).getByText('Fail')).toBeInTheDocument()
    })

    it('never renders "unknown" checks as "fail" — the honesty-critical distinction', async () => {
        mockGetSecurityScan.mockResolvedValue(baseScanResponse())
        mockGetSecurityPostureSummary.mockResolvedValue({ summary: 's', topActions: [] })
        renderWithProviders(<SecurityScanModal isOpen onClose={vi.fn()} repo={REPO} />)

        const list = await screen.findByTestId('security-check-list')
        for (const id of ['secret_scanning', 'secret_scanning_push_protection', 'dependabot_security_updates', 'workflow_permissions']) {
            const row = within(list).getByTestId(`security-check-${id}`)
            expect(within(row).queryByText('Fail')).not.toBeInTheDocument()
            expect(within(row).getByText(/Unknown — admin required/i)).toBeInTheDocument()
        }
    })

    it('shows the partial-visibility caveat when the score has unknown checks', async () => {
        mockGetSecurityScan.mockResolvedValue(baseScanResponse())
        mockGetSecurityPostureSummary.mockResolvedValue({ summary: 's', topActions: [] })
        renderWithProviders(<SecurityScanModal isOpen onClose={vi.fn()} repo={REPO} />)

        expect(await screen.findByText(/don't have admin access to see every check/i)).toBeInTheDocument()
    })

    it('collapses the alert-source sections by default', async () => {
        mockGetSecurityScan.mockResolvedValue(baseScanResponse({ summary: { critical: 1, high: 0, medium: 0, low: 0, total: 1 } }))
        mockGetSecurityPostureSummary.mockResolvedValue({ summary: 's', topActions: [] })
        renderWithProviders(<SecurityScanModal isOpen onClose={vi.fn()} repo={REPO} />)

        await screen.findByTestId('security-check-list')
        const toggle = screen.getByRole('button', { name: /alert details/i })
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('renders the AI summary once it resolves, without blocking the report card', async () => {
        mockGetSecurityScan.mockResolvedValue(baseScanResponse())
        mockGetSecurityPostureSummary.mockResolvedValue({
            summary: 'Three checks need attention.',
            topActions: [{ title: 'Enable branch protection', why: 'Prevents unreviewed merges', severity: 'critical' }],
        })
        renderWithProviders(<SecurityScanModal isOpen onClose={vi.fn()} repo={REPO} />)

        // Report card is present immediately, before the AI call resolves.
        await screen.findByTestId('security-check-list')

        await waitFor(() => expect(screen.getByTestId('security-ai-summary')).toBeInTheDocument())
        expect(screen.getByText('Three checks need attention.')).toBeInTheDocument()
        expect(screen.getByText('Enable branch protection')).toBeInTheDocument()
    })

    it('degrades to a quiet "unavailable" note when the AI summary call fails — never an error banner', async () => {
        mockGetSecurityScan.mockResolvedValue(baseScanResponse())
        mockGetSecurityPostureSummary.mockRejectedValue(Object.assign(new Error('quota exceeded'), { status: 429 }))
        renderWithProviders(<SecurityScanModal isOpen onClose={vi.fn()} repo={REPO} />)

        // Checks still render fully.
        const list = await screen.findByTestId('security-check-list')
        expect(within(list).getAllByTestId(/^security-check-/)).toHaveLength(10)

        await waitFor(() => expect(screen.getByTestId('security-ai-summary-unavailable')).toBeInTheDocument())
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('surfaces a genuine fetch error for the report card itself', async () => {
        mockGetSecurityScan.mockRejectedValue(new Error('network down'))
        renderWithProviders(<SecurityScanModal isOpen onClose={vi.fn()} repo={REPO} />)

        expect(await screen.findByText(/network down/i)).toBeInTheDocument()
        expect(screen.queryByTestId('security-check-list')).not.toBeInTheDocument()
    })

    it('offers a Retry action on a load error, and recovers the report card on click', async () => {
        const user = userEvent.setup()
        mockGetSecurityScan.mockRejectedValueOnce(new Error('network down'))
        mockGetSecurityPostureSummary.mockResolvedValue({ summary: 's', topActions: [] })
        renderWithProviders(<SecurityScanModal isOpen onClose={vi.fn()} repo={REPO} />)

        expect(await screen.findByText(/network down/i)).toBeInTheDocument()
        const retryButton = screen.getByRole('button', { name: /retry/i })
        const callsBeforeRetry = mockGetSecurityScan.mock.calls.length

        mockGetSecurityScan.mockResolvedValueOnce(baseScanResponse())
        await user.click(retryButton)

        expect(await screen.findByTestId('security-check-list')).toBeInTheDocument()
        // Mock accumulates calls across this file's earlier tests (it's never
        // reset between `it`s here) — assert the retry click added exactly
        // one more call rather than an absolute count.
        expect(mockGetSecurityScan.mock.calls.length).toBe(callsBeforeRetry + 1)
    })

    it('allows backdrop-dismiss — this read-only surface has no in-flight write to protect', async () => {
        mockGetSecurityScan.mockResolvedValue(baseScanResponse())
        mockGetSecurityPostureSummary.mockResolvedValue({ summary: 's', topActions: [] })
        const onClose = vi.fn()
        renderWithProviders(<SecurityScanModal isOpen onClose={onClose} repo={REPO} />)

        await screen.findByTestId('security-check-list')
        const backdrop = document.querySelector('[data-modal-backdrop="true"]')
        expect(backdrop).not.toBeNull()
        fireEvent.click(backdrop)

        expect(onClose).toHaveBeenCalledTimes(1)
    })
})
