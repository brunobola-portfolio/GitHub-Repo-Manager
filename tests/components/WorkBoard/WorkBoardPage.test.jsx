import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock MOCK_MODE=true so no real fetches happen during component tests
// ---------------------------------------------------------------------------
vi.mock('@/config', () => ({
    MOCK_MODE: true,
    API_BASE_URL: '',
}))

// ---------------------------------------------------------------------------
// Mock useTrackedRepos so WorkBoardRowMenu doesn't require TrackedReposProvider
// ---------------------------------------------------------------------------
vi.mock('@/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => ({
        repos: [],
        pin: vi.fn(),
        unpin: vi.fn(),
        mute: vi.fn(),
        unmute: vi.fn(),
        untrack: vi.fn(),
        undo: vi.fn(),
    }),
}))

// ---------------------------------------------------------------------------
// Mock useToast so inline action hooks used by tabs don't require a provider
// ---------------------------------------------------------------------------
vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({
        toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), custom: vi.fn() },
        toasts: [],
        dismissToast: vi.fn(),
    }),
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
const MOCK_DORA_SUMMARY = {
    environment: 'production',
    windowStart: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    deployFrequency: { totalDeployments: 42, perDay: [{ date: '2026-04-01', count: 7 }] },
    leadTime: { sampleSize: 5, medianHours: 18, p50: 18, p90: 36 },
    changeFailureRate: { total: 10, failed: 1, successful: 9, rate: 0.1 },
    mttr: { sampleSize: 1, medianHours: 2, p50: 2, p90: 3, unresolved: 0 },
}
const MOCK_TECH_DEBT = {
    items: [
        { repoFullName: 'org/repo', issueNumber: 99, title: 'Refactor X', labels: ['tech-debt'], openedAt: new Date().toISOString(), ageDays: 7, assignees: [] },
    ],
    hotspots: [{ repoFullName: 'org/repo', count: 1, oldestAgeDays: 7 }],
}

const MOCK_REVIEW_LOAD = [
    { reviewerLogin: 'alice', reviewsSubmitted: 18, reviewsPending: 4 },
]

const mockUseMyPendingReviews = vi.fn(() => ({ data: MOCK_REVIEWS, loading: false, error: null, refresh: vi.fn() }))
const mockUseStalePRs = vi.fn(() => ({ data: MOCK_STALE, loading: false, error: null, refresh: vi.fn() }))
const mockUseMyOpenIssues = vi.fn(() => ({ data: MOCK_ISSUES, loading: false, error: null, refresh: vi.fn() }))
const mockUseDORAMetrics = vi.fn(() => ({ data: MOCK_DORA, loading: false, error: null, refresh: vi.fn() }))
const mockUseDORASummary = vi.fn(() => ({ data: MOCK_DORA_SUMMARY, loading: false, error: null, refresh: vi.fn() }))
const mockUseTechDebt = vi.fn(() => ({ data: MOCK_TECH_DEBT, loading: false, error: null, refresh: vi.fn() }))
const mockUseReviewLoad = vi.fn(() => ({ data: MOCK_REVIEW_LOAD, loading: false, error: null, refresh: vi.fn() }))

vi.mock('@/hooks/useWorkBoard', () => ({
    useMyPendingReviews: () => mockUseMyPendingReviews(),
    useStalePRs: (opts) => mockUseStalePRs(opts),
    useMyOpenIssues: () => mockUseMyOpenIssues(),
    useDORAMetrics: (opts) => mockUseDORAMetrics(opts),
    useDORASummary: (opts) => mockUseDORASummary(opts),
    useTechDebt: (opts) => mockUseTechDebt(opts),
    useReviewLoad: (opts) => mockUseReviewLoad(opts),
    useKpiSnapshots: () => ({ data: [], loading: false, error: null }),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
const { WorkBoardPage } = await import('@/components/WorkBoard/WorkBoardPage')
const { ModalProvider } = await import('@/contexts/ModalContext')

function renderPage(props = {}) {
    return render(
        <ModalProvider>
            <WorkBoardPage repoCount={7} {...props} />
        </ModalProvider>
    )
}

beforeEach(() => {
    vi.clearAllMocks()
    // Mock fetch so AISummaryCard (which POSTs on mount) renders as null silently
    global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ code: 'ai_not_configured' }),
    })
    mockUseMyPendingReviews.mockReturnValue({ data: MOCK_REVIEWS, loading: false, error: null, refresh: vi.fn() })
    mockUseStalePRs.mockReturnValue({ data: MOCK_STALE, loading: false, error: null, refresh: vi.fn() })
    mockUseMyOpenIssues.mockReturnValue({ data: MOCK_ISSUES, loading: false, error: null, refresh: vi.fn() })
    mockUseDORAMetrics.mockReturnValue({ data: MOCK_DORA, loading: false, error: null, refresh: vi.fn() })
    mockUseDORASummary.mockReturnValue({ data: MOCK_DORA_SUMMARY, loading: false, error: null, refresh: vi.fn() })
    mockUseTechDebt.mockReturnValue({ data: MOCK_TECH_DEBT, loading: false, error: null, refresh: vi.fn() })
    mockUseReviewLoad.mockReturnValue({ data: MOCK_REVIEW_LOAD, loading: false, error: null, refresh: vi.fn() })
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

    it('renders all six tabs', () => {
        renderPage()
        expect(screen.getByRole('tab', { name: /my reviews/i })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: /stale prs/i })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: /my issues/i })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: /review load/i })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: /tech debt/i })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: /dora/i })).toBeInTheDocument()
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
        // The row is now an in-app button (clicks open the PR detail panel
        // via app:open-repo-pr); a secondary 'Open on GitHub' anchor stays
        // for users who prefer github.com directly.
        expect(screen.getByText(/fix the bug/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Open PR #42.*Fix the bug.*in app/i })).toBeInTheDocument()
        const githubLink = screen.getAllByRole('link', { name: /open on github/i })[0]
        expect(githubLink).toHaveAttribute('href', 'https://github.com/org/repo/pull/42')
        expect(githubLink).toHaveAttribute('target', '_blank')
    })

    it('My Reviews: shows skeleton when loading', () => {
        mockUseMyPendingReviews.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() })
        renderPage()
        // SkeletonRow now uses the canonical <Skeleton /> primitive which carries
        // the ds-skeleton class (shimmer) instead of the older animate-pulse.
        const { container } = render(
            <ModalProvider>
                <WorkBoardPage />
            </ModalProvider>
        )
        expect(container.querySelector('.ds-skeleton')).toBeInTheDocument()
    })

    it('My Reviews: shows empty state when data is empty array', () => {
        mockUseMyPendingReviews.mockReturnValue({ data: [], loading: false, error: null, refresh: vi.fn() })
        renderPage()
        // EmptyStateDiscovery with no tracked repos shows the first-run discovery CTA
        expect(screen.getByText(/let's find your work/i)).toBeInTheDocument()
    })

    it('My Reviews: secondary "Open on GitHub" link still points to the PR', () => {
        renderPage()
        // Each row exposes a small icon-only link to github.com so users who
        // prefer the GitHub UI keep their escape hatch — but the row's
        // primary affordance opens in-app instead.
        const githubLinks = screen.getAllByRole('link', { name: /open on github/i })
        expect(githubLinks[0].href).toContain('github.com/org/repo/pull/42')
    })

    // ---------------------------------------------------------------------------
    // Tab switching
    // ---------------------------------------------------------------------------

    it('clicking Stale PRs tab shows stale PR data', async () => {
        renderPage()
        fireEvent.click(screen.getByRole('tab', { name: /stale prs/i }))
        // Tab is lazy-loaded; wait for it to mount before asserting content.
        expect(await screen.findByText('Old PR')).toBeInTheDocument()
    })

    it('clicking My Issues tab shows issue data with labels', () => {
        renderPage()
        fireEvent.click(screen.getByRole('tab', { name: /my issues/i }))
        // `bug` may appear both in the filter bar (label chip) and inside the
        // issue row — as long as it renders at least once, the tab is alive.
        expect(screen.getAllByText('bug').length).toBeGreaterThan(0)
    })

    it('clicking DORA tab shows KPI metrics', async () => {
        renderPage()
        fireEvent.click(screen.getByRole('tab', { name: /dora/i }))
        expect(await screen.findByText(/deployments/i)).toBeInTheDocument()
        expect(screen.getByText('42')).toBeInTheDocument()
    })

    // ---------------------------------------------------------------------------
    // Upsell / tier gating
    // ---------------------------------------------------------------------------

    it('DORA tab shows upsell when 403 from backend', async () => {
        const err403 = new Error('upgrade_required')
        err403.status = 403
        mockUseDORASummary.mockReturnValue({ data: null, loading: false, error: err403, refresh: vi.fn() })

        renderPage()
        fireEvent.click(screen.getByRole('tab', { name: /dora/i }))
        expect(await screen.findByText(/enterprise feature/i)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /view enterprise pricing/i })).toBeInTheDocument()
    })

    it('renders a refresh button', () => {
        renderPage()
        expect(screen.getByRole('button', { name: /refresh work board/i })).toBeInTheDocument()
    })

    it('Stale PRs tab shows upsell when 403 from backend', async () => {
        const err403 = new Error('upgrade_required')
        err403.status = 403
        mockUseStalePRs.mockReturnValue({ data: null, loading: false, error: err403, refresh: vi.fn() })

        renderPage()
        fireEvent.click(screen.getByRole('tab', { name: /stale prs/i }))
        expect(await screen.findByText(/pro feature/i)).toBeInTheDocument()
    })

    // ---------------------------------------------------------------------------
    // Keyboard shortcuts
    // ---------------------------------------------------------------------------

    it('pressing ? opens the keyboard help modal', async () => {
        renderPage()
        fireEvent.keyDown(window, { key: '?' })
        expect(await screen.findByText(/keyboard shortcuts/i)).toBeInTheDocument()
    })

    it('dispatching workboard:go-tab switches the active tab', async () => {
        renderPage()
        act(() => {
            window.dispatchEvent(new CustomEvent('workboard:go-tab', { detail: 'techdebt' }))
        })
        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /tech debt/i })).toHaveAttribute('aria-selected', 'true')
        })
    })

    it('dispatching workboard:regenerate-ai re-fires workboard:ai-regenerate-internal', () => {
        renderPage()
        const innerHandler = vi.fn()
        window.addEventListener('workboard:ai-regenerate-internal', innerHandler)
        try {
            act(() => {
                window.dispatchEvent(new CustomEvent('workboard:regenerate-ai'))
            })
            expect(innerHandler).toHaveBeenCalledTimes(1)
        } finally {
            window.removeEventListener('workboard:ai-regenerate-internal', innerHandler)
        }
    })

    it('clicking a tab switches the active section', async () => {
        renderPage()
        fireEvent.click(screen.getByRole('tab', { name: /tech debt/i }))
        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /tech debt/i })).toHaveAttribute('aria-selected', 'true')
        })
    })
})
