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
// Leaf views — stubbed, and this is load-bearing for determinism, not just speed.
//
// All three are React.lazy() in App.jsx, so every assertion below waits on a
// dynamic import; under vitest that import also pays the on-demand transform of
// a very large subtree. Measured on a 20-core box at 2x CPU oversubscription:
// "deep-links straight to repo-detail" went 1237 ms -> 8047 ms and died exactly
// at its 8 s ceiling; "clicking Work Board" 4655 ms -> 12313 ms. Nothing about
// routing changed — the wait window was timing a compiler, which is why raising
// ceilings never stuck (vitest.config.js testTimeout 5 s -> 15 s, then
// per-assertion 8-12 s budgets, and the full suite still went red on a
// different App test almost every run).
//
// These tests are about App's ROUTING — which view mounts, carrying which repo
// — so each stub renders exactly what the assertions below read, and nothing
// else. The real components keep their own coverage in
// tests/components/RepoDetail/*, tests/components/WorkBoard/* and
// tests/components/Dashboard/*.
// ---------------------------------------------------------------------------
vi.mock('@/components/RepoDetail', () => ({
    // App passes repo={selectedRepoDetail}; the hash router seeds
    // { name, full_name, owner } from #/repo/:owner/:name, so full_name is the
    // value that proves App resolved the deep link to the right repository.
    RepoDetail: ({ repo }) => <div data-testid="repo-detail-stub">{repo?.full_name}</div>,
}))
vi.mock('@/components/WorkBoard/WorkBoardPage', () => ({
    // The assertion counts occurrences of /work board/i and requires >1 (the
    // nav button is the other one), so the stub must render the literal title.
    WorkBoardPage: () => <div data-testid="work-board-stub">Work Board</div>,
}))
vi.mock('@/components/Dashboard/DashboardPremium', () => ({
    // The default view's hero is asserted only as "some level-1 heading exists".
    DashboardPremium: () => <h1>Dashboard</h1>,
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
    // Reset the URL hash so routing tests don't leak state into one another.
    window.location.hash = ''
})

describe('App shell (authenticated, MOCK_MODE=true)', () => {
    it('renders without throwing', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(() => renderApp()).not.toThrow()

        // Wait for the Header to settle so lazy render errors (if any)
        // surface as console.error before we assert on them.
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 12000 })

        const calls = errorSpy.mock.calls.flat().map(String).join('\n')
        expect(calls).not.toMatch(/Cannot access .* before initialization/)
        expect(calls).not.toMatch(/ReferenceError/)
        errorSpy.mockRestore()
    })

    it('shows all four top-level nav buttons once authenticated', async () => {
        renderApp()
        // The app kicks off appLoading=true then flips to false after checkAuth
        // resolves (/api/auth/mock). Wait for the logo heading to appear as a
        // stable anchor.
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 12000 })

        // Scope assertions to the DESKTOP <nav> — the mobile nav uses shorter
        // labels ("Repos" not "Repositories") and doesn't include Work Board.
        const navs = await screen.findAllByRole('navigation')
        const desktopNav = navs.find((n) => within(n).queryByText('Repositories'))
        expect(desktopNav).toBeTruthy()

        expect(within(desktopNav).getByText('Dashboard')).toBeInTheDocument()
        expect(within(desktopNav).getByText('Repositories')).toBeInTheDocument()
        expect(within(desktopNav).getByText('Teams')).toBeInTheDocument()
        expect(within(desktopNav).getByText('Work Board')).toBeInTheDocument()
        // Pricing left the primary nav 2026-09-05 (2026-09-04 panel, R1) — it
        // stays reachable via the user menu ("Plans & billing") and the
        // command palette, asserted below, just not as a nav peer.
        expect(within(desktopNav).queryByText('Pricing')).toBeNull()
    })

    it('clicking Work Board switches the active view', { timeout: 30000 }, async () => {
        // The generous budgets below are now headroom, not a workaround: with
        // WorkBoardPage stubbed (see the leaf-view mocks at the top of this
        // file) this test runs in ~170 ms idle and ~1.2 s under 2x CPU
        // oversubscription, against 12 s. They stay wide so a slow CI runner
        // never turns a passing assertion into a timeout, and stay below
        // vitest's 15 s testTimeout so a genuine failure still surfaces as a
        // readable assertion error.
        renderApp()
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 12000 })

        // Default view is dashboard — the Dashboard hero h1 (greeting) is lazy-loaded
        // but should appear after a tick.
        const dashboardHeading = await screen.findByRole('heading', { level: 1 }, { timeout: 12000 })
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
            { timeout: 12000 }
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
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 12000 })

        act(() => {
            // The shortcut listener is bound on document, not window.
            document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
        })

        expect(
            await screen.findByText(/keyboard shortcuts/i, {}, { timeout: 12000 })
        ).toBeInTheDocument()
    })

    it('dark-mode toggle flips the .dark class on <html>', async () => {
        renderApp()
        await screen.findByRole('heading', { name: /repo manager/i }, { timeout: 12000 })

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

// ---------------------------------------------------------------------------
// Hash routing — characterization guard for the bidirectional hash<->activeView
// sync that an eventual `useAppRouter` extraction must preserve: deep-link
// repo-detail (parseRepoHash), HASH_ROUTES lookup, empty-hash -> dashboard, the
// view -> hash sync (VIEW_TO_HASH + replaceState), and the first-mount
// no-double-sync guard (didInitHashSyncRef) that keeps a deep-link hash intact.
// ---------------------------------------------------------------------------
describe('App hash routing (useAppRouter guard)', () => {
    const settle = () =>
        screen.findByRole('heading', { name: /repo manager/i }, { timeout: 12000 })

    // The active view is marked locale-independently on the desktop nav via
    // aria-current="page" — a faster, more reliable signal than waiting on a
    // lazy view's (locale-dependent) content.
    const desktopNav = () =>
        screen.getAllByRole('navigation').find((n) => within(n).queryByText('Repositories'))
    const expectActiveTab = (name) =>
        waitFor(
            () => expect(within(desktopNav()).getByRole('button', { name })).toHaveAttribute('aria-current', 'page'),
            { timeout: 8000 },
        )

    // Pricing left the primary nav 2026-09-05 — it's reached via the user
    // (avatar) menu's "Plans & billing" item instead of a nav button.
    const gotoPricing = async () => {
        fireEvent.click(screen.getByRole('button', { name: /open user menu/i }))
        fireEvent.click(await screen.findByRole('menuitem', { name: /plans.*billing/i }))
    }

    // Pricing has no nav button anymore, so "active" is confirmed by its own
    // page content instead of aria-current on a desktop-nav tab.
    const expectPricingActive = () =>
        waitFor(
            () => expect(screen.getByText(/simple, transparent pricing/i)).toBeInTheDocument(),
            { timeout: 8000 },
        )

    it('deep-links straight to repo-detail when mounted at #/repo/:owner/:name', { timeout: 30000 }, async () => {
        window.location.hash = '#/repo/acme/demo'
        renderApp()
        await waitFor(
            () => expect(screen.getAllByText(/acme\/demo/i).length).toBeGreaterThan(0),
            { timeout: 8000 },
        )
    })

    it('navigates to repo-detail on a hashchange to a repo deep-link', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        act(() => {
            window.location.hash = '#/repo/acme/demo/pulls'
            window.dispatchEvent(new Event('hashchange'))
        })
        await waitFor(
            () => expect(screen.getAllByText(/acme\/demo/i).length).toBeGreaterThan(0),
            { timeout: 8000 },
        )
    })

    it('routes an emptied hash back to the dashboard', { timeout: 30000 }, async () => {
        window.location.hash = '#/repo/acme/demo'
        renderApp()
        await waitFor(
            () => expect(screen.getAllByText(/acme\/demo/i).length).toBeGreaterThan(0),
            { timeout: 8000 },
        )
        act(() => {
            window.location.hash = ''
            window.dispatchEvent(new Event('hashchange'))
        })
        // Empty hash routes home — the Dashboard tab becomes active.
        await expectActiveTab(/dashboard/i)
    })

    it('syncs the URL hash when navigating via the nav (view -> hash)', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await gotoPricing()
        await waitFor(() => expect(window.location.hash).toBe('#/pricing'), { timeout: 12000 })
    })

    it('strips the hash to home when navigating back to Dashboard', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await gotoPricing()
        await waitFor(() => expect(window.location.hash).toBe('#/pricing'), { timeout: 12000 })
        fireEvent.click(within(desktopNav()).getByRole('button', { name: /dashboard/i }))
        await waitFor(() => expect(window.location.hash).toBe(''), { timeout: 12000 })
    })

    it('keeps a deep-link hash intact on first mount (no double-sync)', { timeout: 30000 }, async () => {
        window.location.hash = '#/pricing'
        renderApp()
        await settle()
        // The state->hash effect skips its first run (didInitHashSyncRef), so the
        // deep-link survives mount instead of being stripped to ''.
        await waitFor(() => expect(window.location.hash).toBe('#/pricing'), { timeout: 12000 })
        // ...and it actually routed to pricing (Pricing view rendered, not dashboard).
        await expectPricingActive()
    })
})
