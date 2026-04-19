import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock MOCK_MODE=true so no real fetches happen during component tests
// ---------------------------------------------------------------------------
vi.mock('@/config', () => ({
    MOCK_MODE: true,
    API_BASE_URL: '',
}))

// ---------------------------------------------------------------------------
// Mock framer-motion to avoid animation timing in tests
// ---------------------------------------------------------------------------
vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        motion: new Proxy(actual.motion, {
            get(target, key) {
                // Return a simple wrapper that renders as its base element
                if (typeof key === 'string' && !['div', 'a', 'button', 'span'].includes(key)) {
                    return target[key] ?? target.div
                }
                return target[key]
            }
        }),
        AnimatePresence: ({ children }) => children,
    }
})

// ---------------------------------------------------------------------------
// Mock useWorkBoard hooks with synthetic data
// ---------------------------------------------------------------------------

const MOCK_REVIEWS = [
    { repoFullName: 'org/repo', prNumber: 42, title: 'Fix the bug', authorLogin: 'alice', requestedAt: new Date().toISOString(), ageHours: 2 },
]
const MOCK_STALE = [
    { repoFullName: 'org/old', prNumber: 200, title: 'Old PR', authorLogin: 'bob', openedAt: new Date().toISOString(), ageDays: 14 },
]
const MOCK_ISSUES = [
    { repoFullName: 'org/app', issueNumber: 5, labels: ['bug'], openedAt: new Date().toISOString(), ageDays: 3 },
]
const MOCK_DORA = { totalDeployments: 42, perDay: [{ date: '2026-04-01', count: 7 }], medianLeadTimeHours: 18 }

const mockUseMyPendingReviews = vi.fn(() => ({ data: MOCK_REVIEWS, loading: false, error: null, refresh: vi.fn() }))
const mockUseStalePRs = vi.fn(() => ({ data: MOCK_STALE, loading: false, error: null, refresh: vi.fn() }))
const mockUseMyOpenIssues = vi.fn(() => ({ data: MOCK_ISSUES, loading: false, error: null, refresh: vi.fn() }))
const mockUseDORAMetrics = vi.fn(() => ({ data: MOCK_DORA, loading: false, error: null, refresh: vi.fn() }))

vi.mock('@/hooks/useWorkBoard', () => ({
    useMyPendingReviews: () => mockUseMyPendingReviews(),
    useStalePRs: (opts) => mockUseStalePRs(opts),
    useMyOpenIssues: () => mockUseMyOpenIssues(),
    useDORAMetrics: (opts) => mockUseDORAMetrics(opts),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
const { WorkBoardPage } = await import('@/components/WorkBoard/WorkBoardPage')

function renderPage(props = {}) {
    return render(<WorkBoardPage repoCount={7} {...props} />)
}

beforeEach(() => {
    vi.clearAllMocks()
    mockUseMyPendingReviews.mockReturnValue({ data: MOCK_REVIEWS, loading: false, error: null, refresh: vi.fn() })
    mockUseStalePRs.mockReturnValue({ data: MOCK_STALE, loading: false, error: null, refresh: vi.fn() })
    mockUseMyOpenIssues.mockReturnValue({ data: MOCK_ISSUES, loading: false, error: null, refresh: vi.fn() })
    mockUseDORAMetrics.mockReturnValue({ data: MOCK_DORA, loading: false, error: null, refresh: vi.fn() })
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('WorkBoardPage', () => {
    it('renders the Work Board heading', () => {
        renderPage()
        expect(screen.getByText('Work Board')).toBeInTheDocument()
    })

    it('shows repo count in subtitle', () => {
        renderPage({ repoCount: 12 })
        expect(screen.getByText(/12 repos tracked/i)).toBeInTheDocument()
    })

    it('renders all four tabs', () => {
        renderPage()
        expect(screen.getByRole('button', { name: /my reviews/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /stale prs/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /my issues/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /dora/i })).toBeInTheDocument()
    })

    it('DORA tab has Enterprise badge', () => {
        renderPage()
        expect(screen.getByText('Enterprise')).toBeInTheDocument()
    })

    // ---------------------------------------------------------------------------
    // My Reviews tab (default)
    // ---------------------------------------------------------------------------

    it('My Reviews tab is active by default and shows PR data', () => {
        renderPage()
        // The PR link should be present with the correct href
        const link = screen.getByRole('link', { name: /fix the bug/i })
        expect(link).toBeInTheDocument()
        expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/42')
        expect(link).toHaveAttribute('target', '_blank')
    })

    it('My Reviews: shows skeleton when loading', () => {
        mockUseMyPendingReviews.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() })
        renderPage()
        // Skeleton rows have animate-pulse class
        const { container } = render(<WorkBoardPage />)
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    })

    it('My Reviews: shows empty state when data is empty array', () => {
        mockUseMyPendingReviews.mockReturnValue({ data: [], loading: false, error: null, refresh: vi.fn() })
        renderPage()
        expect(screen.getByText(/no pending reviews/i)).toBeInTheDocument()
    })

    it('My Reviews: clicking PR link has correct GitHub URL', () => {
        renderPage()
        const link = screen.getByRole('link', { name: /fix the bug/i })
        expect(link.href).toContain('github.com/org/repo/pull/42')
    })

    // ---------------------------------------------------------------------------
    // Tab switching
    // ---------------------------------------------------------------------------

    it('clicking Stale PRs tab shows stale PR data', () => {
        renderPage()
        fireEvent.click(screen.getByRole('button', { name: /stale prs/i }))
        expect(screen.getByText('Old PR')).toBeInTheDocument()
    })

    it('clicking My Issues tab shows issue data with labels', () => {
        renderPage()
        fireEvent.click(screen.getByRole('button', { name: /my issues/i }))
        expect(screen.getByText('bug')).toBeInTheDocument()
    })

    it('clicking DORA tab shows KPI metrics', () => {
        renderPage()
        fireEvent.click(screen.getByRole('button', { name: /dora/i }))
        expect(screen.getByText(/deployments/i)).toBeInTheDocument()
        expect(screen.getByText('42')).toBeInTheDocument()
    })

    // ---------------------------------------------------------------------------
    // Upsell / tier gating
    // ---------------------------------------------------------------------------

    it('DORA tab shows upsell when 403 from backend', () => {
        const err403 = new Error('upgrade_required')
        err403.status = 403
        mockUseDORAMetrics.mockReturnValue({ data: null, loading: false, error: err403, refresh: vi.fn() })

        renderPage()
        fireEvent.click(screen.getByRole('button', { name: /dora/i }))
        expect(screen.getByText(/enterprise feature/i)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /view pricing/i })).toBeInTheDocument()
    })

    it('Stale PRs tab shows upsell when 403 from backend', () => {
        const err403 = new Error('upgrade_required')
        err403.status = 403
        mockUseStalePRs.mockReturnValue({ data: null, loading: false, error: err403, refresh: vi.fn() })

        renderPage()
        fireEvent.click(screen.getByRole('button', { name: /stale prs/i }))
        expect(screen.getByText(/pro feature/i)).toBeInTheDocument()
    })
})
