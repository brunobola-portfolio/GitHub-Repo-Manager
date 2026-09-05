/*
 * Characterization guard for App.jsx's org-sidebar region (the repos view's
 * left organization navigation): the collapsed rail (slimOrgContent), the
 * expanded OrgPanel, and the mobile-style overlay with its open/close + Escape
 * behaviour. Locks this before it is extracted into an `OrgSidebar` component.
 *
 * It drives the region through the real repos view (navigate via the `r`
 * shortcut) under both responsive modes (useResponsiveLayout is mocked so the
 * left panel can be forced expanded or slim), asserting:
 *   - expanded  -> OrgPanel renders, wired to onSelectOrg (org switch)
 *   - slim      -> the rail renders; an org button drives the org switch
 *   - slim      -> the expand button opens the overlay; selecting closes it
 *   - overlay   -> Escape closes it
 *
 * OrgPanel is stubbed to prop-echo so the test asserts the region's wiring
 * (which panel renders in which mode, and that selection reaches the
 * org-switch handler) rather than the leaf's internals.
 *
 * The right bulk Sidebar / SlimSidebar rail this guard used to also assert on
 * was removed from the repos view entirely on 2026-09-05 (2026-09-04 panel,
 * item R3 / U22): Quick Actions and Import duplicated header buttons and
 * palette commands, and Action History was empty for a new user — a rail
 * that taught a first-time visitor nothing. Sidebar.jsx / SlimSidebar.jsx no
 * longer exist (their one live part, ActivityRow, moved to
 * src/components/ActivityRow.jsx and now backs the dashboard's Recent
 * Activity section instead), so this guard no longer mocks or asserts on
 * them — the repos view is confirmed mounted via RepoList's own empty state
 * instead of the deleted rail's testid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
    layout: { left: 'expanded', right: 'expanded' },
    fetchOrgRepos: vi.fn(() => Promise.resolve()),
    setSelectedOrg: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/config', () => ({
    MOCK_MODE: true,
    API_BASE_URL: '',
    AUTH_ENDPOINTS: { login: '/api/auth/login', logout: '/api/auth/logout' },
    API_BASE: '/api',
    API_ENDPOINTS: {},
    PAGINATION: { defaultPerPage: 30, perPageOptions: [10, 30, 50, 100] },
}))

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        motion: new Proxy(actual.motion, {
            get(target, key) {
                if (typeof key === 'string' && !['div', 'a', 'button', 'span', 'footer', 'section', 'nav', 'header', 'form', 'ul', 'li', 'h1', 'h2', 'h3', 'aside'].includes(key)) {
                    return target[key] ?? target.div
                }
                return target[key]
            },
        }),
        AnimatePresence: ({ children }) => children,
        MotionConfig: ({ children }) => children,
    }
})

vi.mock('@/api/teams', () => ({
    listTeams: vi.fn().mockResolvedValue({ teams: [] }),
    createTeam: vi.fn(),
    deleteTeam: vi.fn(),
}))

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

vi.mock('@/hooks/useOnboarding', () => ({
    useOnboarding: () => ({ shouldShow: false, markComplete: vi.fn(), markSeen: vi.fn(), reset: vi.fn() }),
}))

// Force the responsive panel modes per test.
vi.mock('@/hooks/useResponsiveLayout', () => ({
    useResponsiveLayout: () => ({ leftMode: h.layout.left, rightMode: h.layout.right }),
}))

vi.mock('@/components/Dashboard/DashboardPremium', () => ({
    DashboardPremium: () => <div data-testid="dashboard-stub">DashboardStub</div>,
}))

// OrgPanel echoes its wiring and exposes selection affordances.
vi.mock('@/components/OrgPanel', () => ({
    OrgPanel: ({ orgs, selectedOrg, onSelectOrg }) => (
        <div data-testid="org-panel" data-orgs={(orgs || []).length} data-selected={selectedOrg || ''}>
            <button onClick={() => onSelectOrg(null)}>op-all</button>
            <button onClick={() => onSelectOrg('acme')}>op-acme</button>
        </div>
    ),
}))

const MOCK_USER = { login: 'octocat', name: 'The Octocat', id: 1, avatar_url: 'https://github.com/octocat.png' }
const ORGS = [
    { login: 'acme', avatar_url: '' },
    { login: 'globex', avatar_url: '' },
]

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
        refresh: h.refresh,
        patchRepoEverywhere: vi.fn(),
        orgs: ORGS,
        selectedOrg: null,
        orgRepos: [],
        stats: {},
        fetchOrgRepos: h.fetchOrgRepos,
        archiveRepos: vi.fn(),
        deleteRepos: vi.fn(),
        createRepo: vi.fn(),
        setSelectedOrg: h.setSelectedOrg,
        fetchOrgs: vi.fn(),
        fetchStats: vi.fn(),
        activity: [],
        askAI: vi.fn(),
        checkAIStatus: vi.fn(),
    }),
}))

const App = (await import('@/App')).default
const { ToastProvider } = await import('@/contexts/ToastProvider')
const { ThemeProvider } = await import('@/hooks/useTheme')

// Pre-resolve the App shell's React.lazy() views at MODULE scope. Otherwise
// their dynamic import — and, under vitest, the on-demand transform of each
// subtree — resolves inside the assertion window, so the test times a compiler
// rather than the behaviour it names. That is what made one App guard test go
// red per full run, a different one each time, all green in isolation.
// Module-scope await is paid once and is not subject to testTimeout.
await Promise.all([
    import('@/components/NotificationLayer'),
    import('@/components/HeaderBanners'),
])


function renderApp() {
    return render(
        <ThemeProvider>
            <ToastProvider>
                <App />
            </ToastProvider>
        </ThemeProvider>
    )
}

const settle = () =>
    screen.findByRole('heading', { name: /repo manager/i }, { timeout: 5000 })

// Navigate to the repos view via the `g r` navigation chord (bare `r` no
// longer navigates — `g` is the chord prefix), then wait for RepoList's own
// empty state ("No repositories yet" — the mock useGitHub below returns
// repos: []) to confirm the view switched. This used to wait on the right
// rail's testid; that rail is gone, so the content column is the only thing
// left that's guaranteed to render in repos view regardless of leftMode.
async function gotoRepos() {
    // Both keys inside one act: the chord window is 800 ms of wall clock, and
    // a separate act per key let React's flush push the second key past it
    // under load, which made this guard flaky rather than wrong.
    await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }))
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))
    })
    await screen.findByText(/no repositories yet/i, {}, { timeout: 8000 })
}

beforeEach(() => {
    vi.clearAllMocks()
    h.layout.left = 'expanded'
    h.layout.right = 'expanded'
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
    })
    document.documentElement.classList.remove('dark')
    window.localStorage.clear()
    window.location.hash = ''
})

describe('App org-sidebar region (OrgSidebar guard)', () => {
    it('renders the expanded OrgPanel (wired to org switch) in repos view', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await gotoRepos()
        const panel = await screen.findByTestId('org-panel', {}, { timeout: 8000 })
        expect(panel).toHaveAttribute('data-orgs', '2')
        fireEvent.click(screen.getByText('op-acme'))
        await waitFor(() => expect(h.fetchOrgRepos).toHaveBeenCalledWith('acme'), { timeout: 5000 })
    })

    it('renders the collapsed rail in slim mode, and a rail org button drives the org switch', { timeout: 30000 }, async () => {
        h.layout.left = 'slim'
        renderApp()
        await settle()
        await gotoRepos()
        // Rail affordances (slimOrgContent), not the expanded OrgPanel.
        expect(await screen.findByRole('button', { name: /expand organization panel/i }, { timeout: 8000 })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /all organizations/i })).toBeInTheDocument()
        expect(screen.queryByTestId('org-panel')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'acme' }))
        await waitFor(() => expect(h.fetchOrgRepos).toHaveBeenCalledWith('acme'), { timeout: 5000 })
    })

    it('opens the org overlay from the rail expand button and closes it on selection', { timeout: 30000 }, async () => {
        h.layout.left = 'slim'
        renderApp()
        await settle()
        await gotoRepos()
        expect(screen.queryByTestId('org-panel')).toBeNull()
        fireEvent.click(await screen.findByRole('button', { name: /expand organization panel/i }, { timeout: 8000 }))
        const overlayPanel = await screen.findByTestId('org-panel', {}, { timeout: 5000 })
        expect(overlayPanel).toBeInTheDocument()
        fireEvent.click(screen.getByText('op-acme'))
        await waitFor(() => expect(h.fetchOrgRepos).toHaveBeenCalledWith('acme'), { timeout: 5000 })
        await waitFor(() => expect(screen.queryByTestId('org-panel')).toBeNull(), { timeout: 5000 })
    })

    it('closes the org overlay on Escape', { timeout: 30000 }, async () => {
        h.layout.left = 'slim'
        renderApp()
        await settle()
        await gotoRepos()
        fireEvent.click(await screen.findByRole('button', { name: /expand organization panel/i }, { timeout: 8000 }))
        await screen.findByTestId('org-panel', {}, { timeout: 5000 })
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
        await waitFor(() => expect(screen.queryByTestId('org-panel')).toBeNull(), { timeout: 5000 })
    })
})
