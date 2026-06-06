/*
 * Characterization guard for App.jsx's APP_EVENTS bridge — the ~13 useEffects
 * that subscribe to the app event bus and turn an emitted event into a state
 * change (navigation, a modal open, or a downstream re-emit).
 *
 * This suite exists to LOCK that emit -> state wiring before the bridge is
 * extracted into a `useAppEventBridge` hook. Each test emits one event on the
 * real bus and asserts the user-visible outcome:
 *   - navigation events  -> aria-current="page" on the desktop nav tab
 *   - repo-detail nav     -> RepoDetail stub renders with the right initialTab
 *   - modal-open events   -> the (stubbed) modal renders with the right props
 *   - quota / onboarding  -> App's own role=dialog wrappers appear
 *   - event -> event       -> the downstream event fires (asserted via onAppEvent)
 *
 * Heavy leaf views/modals are stubbed to lightweight prop-echo components so
 * the guard isolates App's wiring (which effect handles which event, and what
 * state/handler it drives) rather than the leaves' own behaviour. The real
 * RepoDetail render path is separately covered by tests/App.events.test.jsx.
 *
 * NOTE on coverage: REPO_DETAIL_BRANCHES_LOADED feeds only the command-palette
 * entity list (no standalone DOM signal) and is exercised by the same effect
 * shape as the PRS/ISSUES loaders, whose fulfil chain IS asserted below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import { emitAppEvent, onAppEvent, APP_EVENTS } from '@/utils/appEvents'

// ---------------------------------------------------------------------------
// Config — MOCK_MODE=true so checkAuth posts /api/auth/mock and skips OAuth.
// ---------------------------------------------------------------------------
vi.mock('@/config', () => ({
    MOCK_MODE: true,
    API_BASE_URL: '',
    AUTH_ENDPOINTS: { login: '/api/auth/login', logout: '/api/auth/logout' },
    API_BASE: '/api',
    API_ENDPOINTS: {},
    PAGINATION: { defaultPerPage: 30, perPageOptions: [10, 30, 50, 100] },
}))

// framer-motion → bypass heavy animations (same shape as App.test.jsx).
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

// Teams API — stub so the post-auth listTeams() call never hits the network.
vi.mock('@/api/teams', () => ({
    listTeams: vi.fn().mockResolvedValue({ teams: [] }),
    createTeam: vi.fn(),
    deleteTeam: vi.fn(),
}))

// Work Board hooks — stable empty states (their own tests live elsewhere).
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

// Onboarding — shouldShow=false so the 1.5s auto-open tour can't race the
// SHOW_ONBOARDING / SHOW_QUOTA_EXCEEDED dialog assertions. SHOW_ONBOARDING sets
// tourOpen directly, so this mock doesn't mask that path.
vi.mock('@/hooks/useOnboarding', () => ({
    useOnboarding: () => ({ shouldShow: false, markComplete: vi.fn(), markSeen: vi.fn(), reset: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// Heavy leaf stubs — echo the props the bridge drives so we can assert wiring.
// ---------------------------------------------------------------------------
vi.mock('@/components/Dashboard/DashboardPremium', () => ({
    DashboardPremium: () => <div data-testid="dashboard-stub">DashboardStub</div>,
}))

vi.mock('@/components/RepoDetail', () => ({
    RepoDetail: ({ repo, initialTab }) => (
        <div data-testid="repo-detail-stub" data-initial-tab={initialTab}>
            RepoDetailStub: {repo?.full_name || `${repo?.owner?.login}/${repo?.name}`}
        </div>
    ),
}))

vi.mock('@/components/PRReview/PRReviewView', () => ({
    PRReviewView: ({ pullNumber }) => (
        <div data-testid="pr-review-stub">PRReviewStub #{pullNumber}</div>
    ),
}))

vi.mock('@/components/DevToolkit/DevToolkitPanel', () => ({
    DevToolkitPanel: ({ isOpen, modalData }) =>
        isOpen ? (
            <div data-testid="devtoolkit-stub" data-initial-tab={modalData?.initialTab}>DevToolkitStub</div>
        ) : null,
}))

vi.mock('@/components/SettingsModal', () => ({
    SettingsModal: ({ isOpen, initialTab }) =>
        isOpen ? (
            <div data-testid="settings-stub" data-initial-tab={initialTab}>SettingsStub</div>
        ) : null,
}))

vi.mock('@/components/AIPolish/AIPolishModal', () => ({
    AIPolishModal: ({ isOpen, repoFullNames }) =>
        isOpen ? (
            <div data-testid="aipolish-stub">{(repoFullNames || []).join(',')}</div>
        ) : null,
}))

// ---------------------------------------------------------------------------
// useGitHub — authenticated user, empty repo lists (the OPEN_REPO_* handlers
// synthesize a stub repo when not found, so empty lists are fine).
// ---------------------------------------------------------------------------
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

// Imports AFTER mocks so ESM picks up the stubs.
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

const desktopNav = () =>
    screen.getAllByRole('navigation').find((n) => within(n).queryByText('Repositories'))

const expectActiveTab = (name) =>
    waitFor(
        () => expect(within(desktopNav()).getByRole('button', { name })).toHaveAttribute('aria-current', 'page'),
        { timeout: 8000 },
    )

// Open repo-detail and wait for the stub — used to seed `selectedRepoDetail`
// before events whose render path depends on it (START_PR_REVIEW, etc.).
async function openRepoDetail() {
    await act(async () => {
        emitAppEvent(APP_EVENTS.OPEN_REPO_DETAIL, {
            owner: 'acme',
            repo: 'demo',
            repoObject: { id: 42, name: 'demo', full_name: 'acme/demo', owner: { login: 'acme' } },
        })
    })
    await screen.findByTestId('repo-detail-stub', {}, { timeout: 8000 })
}

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

describe('App event bridge (useAppEventBridge guard) — navigation', () => {
    it('NAVIGATE_PRICING routes to the pricing view', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => { emitAppEvent(APP_EVENTS.NAVIGATE_PRICING) })
        await expectActiveTab(/pricing/i)
    })

    it('OPEN_BILLING (alias) also routes to the pricing view', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => { emitAppEvent(APP_EVENTS.OPEN_BILLING) })
        await expectActiveTab(/pricing/i)
    })

    it('NAVIGATE_DASHBOARD routes back to the dashboard', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        // Move off the dashboard first so the return is observable.
        await act(async () => { emitAppEvent(APP_EVENTS.NAVIGATE_PRICING) })
        await expectActiveTab(/pricing/i)
        await act(async () => { emitAppEvent(APP_EVENTS.NAVIGATE_DASHBOARD) })
        await expectActiveTab(/dashboard/i)
    })
})

describe('App event bridge (useAppEventBridge guard) — repo-detail navigation', () => {
    it('OPEN_REPO_DETAIL opens repo-detail on the overview tab', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => {
            emitAppEvent(APP_EVENTS.OPEN_REPO_DETAIL, { owner: 'acme', repo: 'demo' })
        })
        const stub = await screen.findByTestId('repo-detail-stub', {}, { timeout: 8000 })
        expect(stub).toHaveTextContent('acme/demo')
        expect(stub).toHaveAttribute('data-initial-tab', 'overview')
    })

    it('OPEN_REPO_SETTINGS opens repo-detail on the settings tab', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => {
            emitAppEvent(APP_EVENTS.OPEN_REPO_SETTINGS, { owner: 'acme', repo: 'demo' })
        })
        const stub = await screen.findByTestId('repo-detail-stub', {}, { timeout: 8000 })
        expect(stub).toHaveAttribute('data-initial-tab', 'settings')
    })

    it('OPEN_REPO_PR opens repo-detail on the pulls tab', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => {
            emitAppEvent(APP_EVENTS.OPEN_REPO_PR, { repoFullName: 'acme/demo', number: 7 })
        })
        const stub = await screen.findByTestId('repo-detail-stub', {}, { timeout: 8000 })
        expect(stub).toHaveAttribute('data-initial-tab', 'pulls')
    })

    it('OPEN_REPO_ISSUE opens repo-detail on the issues tab', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => {
            emitAppEvent(APP_EVENTS.OPEN_REPO_ISSUE, { repoFullName: 'acme/demo', number: 3 })
        })
        const stub = await screen.findByTestId('repo-detail-stub', {}, { timeout: 8000 })
        expect(stub).toHaveAttribute('data-initial-tab', 'issues')
    })
})

describe('App event bridge (useAppEventBridge guard) — modals & overlays', () => {
    it('OPEN_SETTINGS opens the Settings modal at the requested tab', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => { emitAppEvent(APP_EVENTS.OPEN_SETTINGS, { tab: 'ai' }) })
        const stub = await screen.findByTestId('settings-stub', {}, { timeout: 8000 })
        expect(stub).toHaveAttribute('data-initial-tab', 'ai')
    })

    it('OPEN_SETTINGS with no tab falls back to the general tab', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => { emitAppEvent(APP_EVENTS.OPEN_SETTINGS) })
        const stub = await screen.findByTestId('settings-stub', {}, { timeout: 8000 })
        expect(stub).toHaveAttribute('data-initial-tab', 'general')
    })

    it('OPEN_AI_POLISH opens the AI Polish modal with the repo list', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => {
            emitAppEvent(APP_EVENTS.OPEN_AI_POLISH, { repoFullNames: ['acme/demo', 'acme/other'] })
        })
        const stub = await screen.findByTestId('aipolish-stub', {}, { timeout: 8000 })
        expect(stub).toHaveTextContent('acme/demo,acme/other')
    })

    it('SHOW_QUOTA_EXCEEDED opens the quota dialog', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => {
            emitAppEvent(APP_EVENTS.SHOW_QUOTA_EXCEEDED, { feature: 'AI', tier: 'free' })
        })
        expect(
            await screen.findByRole('dialog', { name: /quota exceeded/i }, { timeout: 8000 })
        ).toBeInTheDocument()
    })

    it('SHOW_ONBOARDING opens the welcome tour', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => { emitAppEvent(APP_EVENTS.SHOW_ONBOARDING) })
        expect(
            await screen.findByRole('dialog', { name: /welcome tour/i }, { timeout: 8000 })
        ).toBeInTheDocument()
    })
})

describe('App event bridge (useAppEventBridge guard) — views requiring an open repo', () => {
    it('START_PR_REVIEW navigates to the PR review view', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await openRepoDetail()
        await act(async () => { emitAppEvent(APP_EVENTS.START_PR_REVIEW, { number: 7 }) })
        const stub = await screen.findByTestId('pr-review-stub', {}, { timeout: 8000 })
        expect(stub).toHaveTextContent('#7')
    })

    it('GENERATE_PR_DESCRIPTION opens the Dev Toolkit on the PR tab', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await openRepoDetail()
        await act(async () => {
            emitAppEvent(APP_EVENTS.GENERATE_PR_DESCRIPTION, {
                number: 7,
                head: { ref: 'feature' },
                base: { ref: 'main' },
            })
        })
        const stub = await screen.findByTestId('devtoolkit-stub', {}, { timeout: 8000 })
        expect(stub).toHaveAttribute('data-initial-tab', 'pr')
    })

    it('GENERATE_PR_DESCRIPTION is a no-op without an open repo', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        await act(async () => {
            emitAppEvent(APP_EVENTS.GENERATE_PR_DESCRIPTION, { number: 7, head: { ref: 'x' }, base: { ref: 'main' } })
        })
        // No selectedRepoDetail -> the handler returns early; the toolkit never opens.
        await waitFor(() => {}, { timeout: 200 })
        expect(screen.queryByTestId('devtoolkit-stub')).toBeNull()
    })
})

describe('App event bridge (useAppEventBridge guard) — event -> event bridges', () => {
    it('OPEN_PR_DETAIL re-emits REPO_DETAIL_SELECT_PR with the same PR', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        const spy = vi.fn()
        const off = onAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_PR, spy)
        const pr = { number: 11, title: 'Fix' }
        await act(async () => { emitAppEvent(APP_EVENTS.OPEN_PR_DETAIL, pr) })
        off()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy.mock.calls[0][0].detail).toEqual(pr)
    })

    it('OPEN_ISSUE_DETAIL re-emits REPO_DETAIL_SELECT_ISSUE with the detail', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        const spy = vi.fn()
        const off = onAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_ISSUE, spy)
        const detail = { issue: { number: 5, title: 'Bug' } }
        await act(async () => { emitAppEvent(APP_EVENTS.OPEN_ISSUE_DETAIL, detail) })
        off()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy.mock.calls[0][0].detail).toEqual(detail)
    })

    it('PLAN_ISSUE_WITH_AI re-emits REPO_DETAIL_PLAN_ISSUE with the issue', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        const spy = vi.fn()
        const off = onAppEvent(APP_EVENTS.REPO_DETAIL_PLAN_ISSUE, spy)
        const issue = { number: 9, title: 'Plan me' }
        await act(async () => { emitAppEvent(APP_EVENTS.PLAN_ISSUE_WITH_AI, issue) })
        off()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy.mock.calls[0][0].detail).toEqual(issue)
    })

    it('MIGRATION_COMPLETE nudges the assistant with an open_ai_polish action', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        const spy = vi.fn()
        const off = onAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, spy)
        await act(async () => {
            emitAppEvent(APP_EVENTS.MIGRATION_COMPLETE, {
                createdRepos: [{ full_name: 'acme/one' }, { full_name: 'acme/two' }],
            })
        })
        off()
        expect(spy).toHaveBeenCalledTimes(1)
        const { detail } = spy.mock.calls[0][0]
        expect(detail.actions[0].type).toBe('open_ai_polish')
        expect(detail.actions[0].payload.repoFullNames).toEqual(['acme/one', 'acme/two'])
    })

    it('MIGRATION_COMPLETE with no created repos is a no-op', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        const spy = vi.fn()
        const off = onAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, spy)
        await act(async () => { emitAppEvent(APP_EVENTS.MIGRATION_COMPLETE, { createdRepos: [] }) })
        off()
        expect(spy).not.toHaveBeenCalled()
    })

    it('OPEN_REPO_PR then REPO_DETAIL_PRS_LOADED fulfils the pending open by selecting the PR', { timeout: 30000 }, async () => {
        renderApp()
        await settle()
        const spy = vi.fn()
        const off = onAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_PR, spy)
        // 1) Cross-surface open records the pending intent + navigates to pulls.
        await act(async () => {
            emitAppEvent(APP_EVENTS.OPEN_REPO_PR, { repoFullName: 'acme/demo', number: 7 })
        })
        await screen.findByTestId('repo-detail-stub', {}, { timeout: 8000 })
        // 2) The tab reports its loaded rows -> the pending PR is selected.
        await act(async () => {
            emitAppEvent(APP_EVENTS.REPO_DETAIL_PRS_LOADED, [{ number: 7, title: 'Pending' }, { number: 8 }])
        })
        off()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy.mock.calls[0][0].detail).toEqual({ number: 7, title: 'Pending' })
    })
})
