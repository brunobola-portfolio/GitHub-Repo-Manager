/*
 * Behavior coverage for App-level window event listeners that bridge the
 * action registry to navigation. Each event has a producer (an action's
 * `run`) and a consumer (a useEffect in App.jsx). When the consumer is
 * missing — as happened with `app:open-repo-detail` — the action fires
 * silently and the user sees nothing happen. These tests catch that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, cleanup } from '@testing-library/react'
import { emitAppEvent, APP_EVENTS } from '../src/utils/appEvents'

// We mock useGitHub to return a logged-in user, so App lets the
// repo-detail view render. Mock has the full destructured shape — missing
// keys would mask render-time bugs.
vi.mock('../src/hooks/useGitHub', () => ({
  useGitHub: () => ({
    repos: [],
    user: { login: 'alice', id: 7, avatar_url: '' },
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
    patchRepoLocal: vi.fn(),
    patchOrgRepoLocal: vi.fn(),
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
    checkAIStatus: vi.fn(() => Promise.resolve({ configured: false })),
  }),
}))

vi.mock('../src/api/teams', () => ({
  listTeams: vi.fn().mockResolvedValue({ teams: [] }),
  createTeam: vi.fn(),
  deleteTeam: vi.fn(),
}))

// RepoDetail is a React.lazy() in App.jsx, so rendering the real one puts its
// dynamic import — and vitest's on-demand transform of a very large subtree —
// inside the waitFor below, which then times a compiler instead of the event
// bridge under test. This file is about the LISTENER firing and mounting the
// view with the right repo, so the leaf is stubbed to just that. Same root
// cause and fix as tests/components/App.test.jsx; measurements are in the note
// there.
vi.mock('../src/components/RepoDetail', () => ({
  RepoDetail: ({ repo }) => <div data-testid="repo-detail-stub">{repo?.full_name}</div>,
}))

// framer-motion's real animation machinery is a large dependency to transform
// and drives timers this file never asserts on. Same proxy shape as
// tests/components/App.test.jsx.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    AnimatePresence: ({ children }) => children,
    MotionConfig: ({ children }) => children,
  }
})

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: false,
    status: 401,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  }))
})

// Imported at module scope, NOT inside renderApp(). An `await import()` in the
// helper runs inside the test body, so vitest's transform of App.jsx and its
// whole eager import graph counted against the per-test timeout — this test
// was hitting 30 s under a saturated pool while asserting nothing but that an
// event listener fired. Module-scope await is paid once, outside any test's
// clock. (Mocks above are hoisted, so App still sees the stubs.)
const { default: App } = await import('../src/App.jsx')
const { ToastProvider } = await import('../src/contexts/ToastProvider.jsx')
const { ThemeProvider } = await import('../src/hooks/useTheme.jsx')

function renderApp() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  )
}

describe('App window-event navigation', () => {
  it('app:open-repo-detail navigates to the repo detail view (regression: previously silently dropped)', { timeout: 30000 }, async () => {
    await renderApp()

    await act(async () => {
      emitAppEvent(APP_EVENTS.OPEN_REPO_DETAIL, {
        owner: 'acme',
        repo: 'demo',
        repoObject: {
          id: 42,
          name: 'demo',
          full_name: 'acme/demo',
          owner: { login: 'acme' },
          description: 'Test repo',
          html_url: 'https://github.com/acme/demo',
          private: false,
          stargazers_count: 0,
          watchers_count: 0,
          forks_count: 0,
          open_issues_count: 0,
          default_branch: 'main',
        },
      })
    })

    // RepoDetail renders the full_name as the page title via PageHeader.
    // Use findByText with a regex to be tolerant of surrounding chrome.
    await waitFor(
      () => expect(screen.getAllByText(/acme\/demo/i).length).toBeGreaterThan(0),
      { timeout: 10000 },
    )

    cleanup()
  })

  it('app:open-repo-detail with no payload is a safe no-op', { timeout: 30000 }, async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderApp()

    await act(async () => {
      emitAppEvent(APP_EVENTS.OPEN_REPO_DETAIL, {})
      emitAppEvent(APP_EVENTS.OPEN_REPO_DETAIL)
    })

    // No throw, no navigation — repo detail was never opened.
    // The dashboard or repos view should remain mounted; we just assert
    // that no React render error fired.
    const calls = errorSpy.mock.calls.flat().map(String).join('\n')
    expect(calls).not.toMatch(/Cannot access .* before initialization/)
    expect(calls).not.toMatch(/ReferenceError/)

    errorSpy.mockRestore()
    cleanup()
  })
})
