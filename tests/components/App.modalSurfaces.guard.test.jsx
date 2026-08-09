/*
 * Characterization guard for App.jsx's modal-surfaces block — the contiguous
 * run of ModalContext-driven lazy modals (CreateRepo, Transfer, OrgManager,
 * DevToolkit, Settings, RepoInsights, SuggestNameDescription, AIPolish,
 * CommunityHealth, MigrationHistory, MigrationWizard, BatchIndex, Compare,
 * SecurityScan, LicenseActivation) plus ConfirmModal and KeyboardShortcutsHelp.
 *
 * Locks the open -> render -> close lifecycle wiring BEFORE that block is
 * extracted into a `ModalSurfaces` component, so the extraction can't drop a
 * modal, mis-wire an onClose, or forget a prop.
 *
 * It drives every modal reachable from App's own surface — global keyboard
 * shortcuts (n / i / g / ?) and the OPEN_SETTINGS / OPEN_AI_POLISH bus events —
 * spanning the rendering shapes that matter for the move: an isOpen-prop modal,
 * a `{state && (...)}`-gated modal, an ErrorBoundary+Suspense lazy modal, and
 * the non-ModalContext help modal (showHelp). Each opened modal is stubbed to a
 * prop-echo so we assert the wiring (isOpen, onClose, and a representative
 * passthrough prop) rather than the leaf's internals.
 *
 * The remaining modals in the block are opened only from deep child surfaces
 * (context menus, RepoDetail, bulk actions) not reachable here; their move is
 * mechanical and is covered by the full unit suite + lint + build.
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

vi.mock('@/components/Dashboard/DashboardPremium', () => ({
    DashboardPremium: () => <div data-testid="dashboard-stub">DashboardStub</div>,
}))

// ---------------------------------------------------------------------------
// Modal leaf stubs for the surfaces we drive. Each echoes the props that the
// block must keep passing and exposes a close button wired to onClose.
// ---------------------------------------------------------------------------
vi.mock('@/components/CreateRepoModal', () => ({
    CreateRepoModal: ({ isOpen, onClose, orgs, onCreate }) =>
        isOpen ? (
            <div data-testid="m-create" data-orgs={(orgs || []).length} data-has-create={typeof onCreate === 'function'}>
                <button onClick={onClose}>close-create</button>
            </div>
        ) : null,
}))

vi.mock('@/components/DevToolkit/DevToolkitPanel', () => ({
    DevToolkitPanel: ({ isOpen, onClose }) =>
        isOpen ? (
            <div data-testid="m-devtoolkit"><button onClick={onClose}>close-devtoolkit</button></div>
        ) : null,
}))

vi.mock('@/components/SettingsModal', () => ({
    SettingsModal: ({ isOpen, onClose, initialTab }) =>
        isOpen ? (
            <div data-testid="m-settings" data-initial-tab={initialTab}><button onClick={onClose}>close-settings</button></div>
        ) : null,
}))

vi.mock('@/components/AIPolish/AIPolishModal', () => ({
    AIPolishModal: ({ isOpen, onClose, repoFullNames }) =>
        isOpen ? (
            <div data-testid="m-aipolish" data-count={(repoFullNames || []).length}><button onClick={onClose}>close-aipolish</button></div>
        ) : null,
}))

vi.mock('@/components/MigrationWizard/MigrationWizard', () => ({
    // default export — `{state && (...)}`-gated, so it only mounts when open.
    default: ({ onClose, orgs }) => (
        <div data-testid="m-wizard" data-orgs={(orgs || []).length}><button onClick={onClose}>close-wizard</button></div>
    ),
}))

vi.mock('@/components/KeyboardShortcutsHelp', () => ({
    KeyboardShortcutsHelp: ({ isOpen, onClose, shortcuts }) =>
        isOpen ? (
            <div data-testid="m-help" data-count={(shortcuts || []).length}><button onClick={onClose}>close-help</button></div>
        ) : null,
}))

const MOCK_USER = { login: 'octocat', name: 'The Octocat', id: 1, avatar_url: 'https://github.com/octocat.png' }

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
        patchRepoEverywhere: vi.fn(),
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
    import('@/components/SlimSidebar'),
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

// Global single-key shortcuts are bound on document and gated by
// `!!user && !anyModalOpen`.
const pressKey = (key) =>
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key })) })

beforeEach(() => {
    vi.clearAllMocks()
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

describe('App modal surfaces (ModalSurfaces guard)', () => {
    it("'n' opens CreateRepoModal (orgs + onCreate wired) and its close button closes it", { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await pressKey('n')
        const m = await screen.findByTestId('m-create', {}, { timeout: 8000 })
        expect(m).toHaveAttribute('data-orgs', '0')
        expect(m).toHaveAttribute('data-has-create', 'true')
        fireEvent.click(screen.getByText('close-create'))
        await waitFor(() => expect(screen.queryByTestId('m-create')).toBeNull(), { timeout: 5000 })
    })

    it("'i' opens MigrationWizard (orgs wired) and closes it", { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await pressKey('i')
        const m = await screen.findByTestId('m-wizard', {}, { timeout: 8000 })
        expect(m).toHaveAttribute('data-orgs', '0')
        fireEvent.click(screen.getByText('close-wizard'))
        await waitFor(() => expect(screen.queryByTestId('m-wizard')).toBeNull(), { timeout: 5000 })
    })

    it("'g' opens DevToolkitPanel and closes it", { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await pressKey('g')
        await screen.findByTestId('m-devtoolkit', {}, { timeout: 8000 })
        fireEvent.click(screen.getByText('close-devtoolkit'))
        await waitFor(() => expect(screen.queryByTestId('m-devtoolkit')).toBeNull(), { timeout: 5000 })
    })

    it("'?' opens KeyboardShortcutsHelp (shortcuts wired) and closes it", { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await pressKey('?')
        const m = await screen.findByTestId('m-help', {}, { timeout: 8000 })
        expect(Number(m.getAttribute('data-count'))).toBeGreaterThan(0)
        fireEvent.click(screen.getByText('close-help'))
        await waitFor(() => expect(screen.queryByTestId('m-help')).toBeNull(), { timeout: 5000 })
    })

    it('OPEN_SETTINGS opens SettingsModal at the requested tab and closes it', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => { emitAppEvent(APP_EVENTS.OPEN_SETTINGS, { tab: 'ai' }) })
        const m = await screen.findByTestId('m-settings', {}, { timeout: 8000 })
        expect(m).toHaveAttribute('data-initial-tab', 'ai')
        fireEvent.click(screen.getByText('close-settings'))
        await waitFor(() => expect(screen.queryByTestId('m-settings')).toBeNull(), { timeout: 5000 })
    })

    it('OPEN_AI_POLISH opens AIPolishModal with the repo list and closes it', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => {
            emitAppEvent(APP_EVENTS.OPEN_AI_POLISH, { repoFullNames: ['acme/one', 'acme/two'] })
        })
        const m = await screen.findByTestId('m-aipolish', {}, { timeout: 8000 })
        expect(m).toHaveAttribute('data-count', '2')
        fireEvent.click(screen.getByText('close-aipolish'))
        await waitFor(() => expect(screen.queryByTestId('m-aipolish')).toBeNull(), { timeout: 5000 })
    })

    it('modals are closed by default (nothing opened on mount)', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        expect(screen.queryByTestId('m-create')).toBeNull()
        expect(screen.queryByTestId('m-wizard')).toBeNull()
        expect(screen.queryByTestId('m-devtoolkit')).toBeNull()
        expect(screen.queryByTestId('m-settings')).toBeNull()
        expect(screen.queryByTestId('m-aipolish')).toBeNull()
        expect(screen.queryByTestId('m-help')).toBeNull()
    })
})
