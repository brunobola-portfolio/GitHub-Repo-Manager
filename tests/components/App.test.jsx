import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Config — MOCK_MODE=true so App's checkAuth path posts to /api/auth/mock and
// bypasses the system-setup flow + real OAuth session probe.
// ---------------------------------------------------------------------------
vi.mock('@/config', () => ({
    MOCK_MODE: true,
    API_BASE_URL: '',
    AUTH_ENDPOINTS: {
        login: '/api/auth/login',
        logout: '/api/auth/logout',
    },
    API_BASE: '/api',
    API_ENDPOINTS: {},
    PAGINATION: { defaultPerPage: 30, perPageOptions: [10, 30, 50, 100] },
}))

// ---------------------------------------------------------------------------
// framer-motion → bypass heavy animations (same shape as WorkBoardPage test)
// ---------------------------------------------------------------------------
vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        motion: new Proxy(actual.motion, {
            get(target, key) {
                if (typeof key === 'string' && !['div', 'a', 'button', 'span', 'footer', 'section', 'nav', 'header', 'form', 'ul', 'li', 'h1', 'h2', 'h3'].includes(key)) {
                    return target[key] ?? target.div
                }
                return target[key]
            },
        }),
        AnimatePresence: ({ children }) => children,
        MotionConfig: ({ children }) => children,
    }
})

// ---------------------------------------------------------------------------
// Stub ALL teams API calls — App mounts and fires listTeams() once we have a
// user. An unmocked fetch would hang in happy-dom.
// ---------------------------------------------------------------------------
vi.mock('../../src/api/teams', () => ({
    listTeams: vi.fn().mockResolvedValue({ teams: [] }),
    createTeam: vi.fn(),
    deleteTeam: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Work Board hooks — mocked to stable empty states. Their tab tests live in
// tests/components/WorkBoard/WorkBoardPage.test.jsx.
// ---------------------------------------------------------------------------
vi.mock('@/hooks/useWorkBoard', () => ({
    useMyPendingReviews: () => ({ data: [], loading: false, error: null, refresh: vi.fn() }),
    useStalePRs: () => ({ data: [], loading: false, error: null, refresh: vi.fn() }),
    useMyOpenIssues: () => ({ data: [], loading: false, error: null, refresh: vi.fn() }),
    useDORAMetrics: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }),
    useDORASummary: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }),
    useTechDebt: () => ({ data: null, loading: false, error: null, refresh: vi.fn() }),
    useReviewLoad: () => ({ data: [], loading: false, error: null, refresh: vi.fn() }),
    useKpiSnapshots: () => ({ data: [], loading: false, error: null, refresh: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// useGitHub — return an authenticated user so App skips the LandingPage and
// renders the Header + main view container. Every key destructured in
// src/App.jsx is provided to avoid silent undefined reads.
// ---------------------------------------------------------------------------
const MOCK_USER = {
    login: 'octocat',
    name: 'The Octocat',
    id: 1,
    avatar_url: 'https://github.com/octocat.png',
}

vi.mock('@/hooks/useGitHub', () => ({
    useGitHub: () => ({
        repos: [],
        user: MOCK_USER,
        loading: false,
        error: null,
        errorInfo: null,
        message: '',
        page: 1,
        perPage: 30,
        totalPages: 1,
        isPerforming: false,
        results: [],
        isMockMode: true,
        setPage: vi.fn(),
        performAction: vi.fn(),
        fetchUser: vi.fn(),
        refresh: vi.fn(),
        orgs: [],
        selectedOrg: null,
        orgRepos: [],
        stats: {},
        fetchOrgRepos: vi.fn(),
        archiveRepos: vi.fn(),
        deleteRepos: vi.fn(),
        createRepo: vi.fn(),
        setSelectedOrg: vi.fn(),
        fetchOrgs: vi.fn(),
        fetchStats: vi.fn(),
        activity: [],
        askAI: vi.fn(),
        checkAIStatus: vi.fn(),
    }),
}))

// ---------------------------------------------------------------------------
// Imports happen AFTER mocks so ESM picks up the stubs.
// ---------------------------------------------------------------------------
const App = (await import('@/App')).default
const { ToastProvider } = await import('@/contexts/ToastProvider')
const { ThemeProvider } = await import('@/hooks/useTheme')

function renderApp() {
    return render(
        <ThemeProvider>
            <ToastProvider>
                <App />
            </ToastProvider>
        </ThemeProvider>
    )
}

beforeEach(() => {
    vi.clearAllMocks()
    // Block any outbound fetch: /api/auth/mock (mock-mode checkAuth),
    // /api/v1/license (LicenseBadge), /api/work-board/* (tab fetch),
    // etc. Everything resolves with a benign 404/empty body so App's
    // graceful-degradation paths run.
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
    })
    // Reset the <html class="dark"> between tests so theme toggle assertions
    // start from a known state.
    document.documentElement.classList.remove('dark')
    window.localStorage.clear()
})

describe('App shell (authenticated, MOCK_MODE=true)', () => {
    it('renders without throwing', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(() => renderApp()).not.toThrow()

        // Wait for the Header to settle so lazy render errors (if any)
        // surface as console.error before we assert on them.
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 5000 })

        const calls = errorSpy.mock.calls.flat().map(String).join('\n')
        expect(calls).not.toMatch(/Cannot access .* before initialization/)
        expect(calls).not.toMatch(/ReferenceError/)
        errorSpy.mockRestore()
    })

    it('shows all five top-level nav buttons once authenticated', async () => {
        renderApp()
        // The app kicks off appLoading=true then flips to false after checkAuth
        // resolves (/api/auth/mock). Wait for the logo heading to appear as a
        // stable anchor.
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 5000 })

        // Scope assertions to the DESKTOP <nav> — the mobile nav uses shorter
        // labels ("Repos" not "Repositories") and doesn't include Work Board.
        const navs = await screen.findAllByRole('navigation')
        const desktopNav = navs.find((n) => within(n).queryByText('Repositories'))
        expect(desktopNav).toBeTruthy()

        expect(within(desktopNav).getByText('Dashboard')).toBeInTheDocument()
        expect(within(desktopNav).getByText('Repositories')).toBeInTheDocument()
        expect(within(desktopNav).getByText('Teams')).toBeInTheDocument()
        expect(within(desktopNav).getByText('Work Board')).toBeInTheDocument()
        expect(within(desktopNav).getByText('Pricing')).toBeInTheDocument()
    })

    it('clicking Work Board switches the active view', { timeout: 30000 }, async () => {
        renderApp()
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 5000 })

        // Default view is dashboard — the Dashboard hero h1 (greeting) is lazy-loaded
        // but should appear after a tick.
        const dashboardHeading = await screen.findByRole('heading', { level: 1 }, { timeout: 5000 })
        expect(dashboardHeading).toBeInTheDocument()

        // Click Work Board in the desktop nav. Use the nav scope to avoid the
        // slim Sidebar's Kanban icon button (also named "Work Board").
        const navs = screen.getAllByRole('navigation')
        const desktopNav = navs.find((n) => within(n).queryByText('Work Board'))
        fireEvent.click(within(desktopNav).getByRole('button', { name: /work board/i }))

        // Work Board page renders the literal string "Work Board" as its title.
        await waitFor(
            () => {
                // Multiple "Work Board" strings appear (nav button, page title,
                // aria labels) — existence is enough to prove the switch.
                const matches = screen.getAllByText(/work board/i)
                expect(matches.length).toBeGreaterThan(1)
            },
            { timeout: 5000 }
        )

        // After switching to Work Board the dashboard hero h1 should be gone.
        // Work Board renders its own h1 ("Work Board"), so we just verify the
        // dashboard greeting h1 is no longer present by confirming no h1 with
        // a greeting pattern exists.
        const remainingH1s = screen.queryAllByRole('heading', { level: 1 })
        const hasGreeting = remainingH1s.some(el => /bom\s|boa\s/i.test(el.textContent))
        expect(hasGreeting).toBe(false)
    })

    it('pressing ? opens the global keyboard shortcuts help modal', async () => {
        renderApp()
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 5000 })

        act(() => {
            // The shortcut listener is bound on document, not window.
            document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
        })

        expect(
            await screen.findByText(/keyboard shortcuts/i, {}, { timeout: 5000 })
        ).toBeInTheDocument()
    })

    it('dark-mode toggle flips the .dark class on <html>', async () => {
        renderApp()
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 5000 })

        // Start light: the test setup clears localStorage + class, and
        // matchMedia is mocked to "not dark".
        expect(document.documentElement.classList.contains('dark')).toBe(false)

        // The theme toggle is labeled "Switch to dark mode" when currently light.
        const toggle = screen.getByRole('button', { name: /switch to dark mode/i })
        fireEvent.click(toggle)

        await waitFor(() => {
            expect(document.documentElement.classList.contains('dark')).toBe(true)
        })
    })
})
