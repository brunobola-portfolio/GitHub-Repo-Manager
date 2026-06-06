/*
 * Characterization guard for App.jsx's notification layer — the bottom-of-tree
 * global overlay surfaces (ToastContainer, PendingSyncBanner, OnboardingTour,
 * the quota-exceeded dialog, OfflineBanner). Locks the dismiss lifecycle before
 * the block is extracted into a `NotificationLayer` component.
 *
 * The *open* wiring of the quota dialog and the welcome tour is already locked
 * by App.eventBridge.guard (emit SHOW_QUOTA_EXCEEDED / SHOW_ONBOARDING). This
 * suite adds the part the extraction actually rewires — the *close* paths:
 *   - quota dialog: Escape closes, backdrop click closes
 *   - welcome tour: the close control closes it
 *
 * These run against the real App so they hold whether the markup is inline
 * (today) or inside NotificationLayer (after the extraction).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { emitAppEvent, APP_EVENTS } from '@/utils/appEvents'

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

// shouldShow=false so the 1.5s auto-tour can't race the explicit-emit assertions.
vi.mock('@/hooks/useOnboarding', () => ({
    useOnboarding: () => ({ shouldShow: false, markComplete: vi.fn(), markSeen: vi.fn(), reset: vi.fn() }),
}))

vi.mock('@/components/Dashboard/DashboardPremium', () => ({
    DashboardPremium: () => <div data-testid="dashboard-stub">DashboardStub</div>,
}))

const MOCK_USER = { login: 'octocat', name: 'The Octocat', id: 1, avatar_url: 'https://github.com/octocat.png' }

vi.mock('@/hooks/useGitHub', () => ({
    useGitHub: () => ({
        repos: [], user: MOCK_USER, loading: false, error: null, errorInfo: null, message: '',
        page: 1, perPage: 30, totalPages: 1, isPerforming: false, results: [], isMockMode: true,
        setPage: vi.fn(), performAction: vi.fn(), fetchUser: vi.fn(), refresh: vi.fn(),
        patchRepoEverywhere: vi.fn(), orgs: [], selectedOrg: null, orgRepos: [], stats: {},
        fetchOrgRepos: vi.fn(), archiveRepos: vi.fn(), deleteRepos: vi.fn(), createRepo: vi.fn(),
        setSelectedOrg: vi.fn(), fetchOrgs: vi.fn(), fetchStats: vi.fn(), activity: [],
        askAI: vi.fn(), checkAIStatus: vi.fn(),
    }),
}))

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

const settle = () =>
    screen.findByRole('heading', { name: /repo manager/i }, { timeout: 5000 })

beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
    document.documentElement.classList.remove('dark')
    window.localStorage.clear()
    window.location.hash = ''
})

describe('App notification layer (NotificationLayer guard)', () => {
    it('quota dialog: opens on SHOW_QUOTA_EXCEEDED and closes on Escape', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => { emitAppEvent(APP_EVENTS.SHOW_QUOTA_EXCEEDED, { feature: 'AI', tier: 'free' }) })
        const dialog = await screen.findByRole('dialog', { name: /quota exceeded/i }, { timeout: 8000 })
        fireEvent.keyDown(dialog, { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /quota exceeded/i })).toBeNull(), { timeout: 5000 })
    })

    it('quota dialog: closes on backdrop click', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => { emitAppEvent(APP_EVENTS.SHOW_QUOTA_EXCEEDED, { feature: 'AI', tier: 'free' }) })
        const dialog = await screen.findByRole('dialog', { name: /quota exceeded/i }, { timeout: 8000 })
        fireEvent.click(dialog)
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /quota exceeded/i })).toBeNull(), { timeout: 5000 })
    })

    it('welcome tour: opens on SHOW_ONBOARDING and closes via its close control', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => { emitAppEvent(APP_EVENTS.SHOW_ONBOARDING) })
        await screen.findByRole('dialog', { name: /welcome tour/i }, { timeout: 8000 })
        fireEvent.click(screen.getByRole('button', { name: /close tour/i }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /welcome tour/i })).toBeNull(), { timeout: 5000 })
    })
})
