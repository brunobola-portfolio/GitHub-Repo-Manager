/*
 * Behavior coverage for App-level window event listeners that bridge the
 * action registry to navigation. Each event has a producer (an action's
 * `run`) and a consumer (a useEffect in App.jsx). When the consumer is
 * missing — as happened with `app:open-repo-detail` — the action fires
 * silently and the user sees nothing happen. These tests catch that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, cleanup } from '@testing-library/react'

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

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: false,
    status: 401,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  }))
})

async function renderApp() {
  const { default: App } = await import('../src/App.jsx')
  const { ToastProvider } = await import('../src/contexts/ToastProvider.jsx')
  const { ThemeProvider } = await import('../src/hooks/useTheme.jsx')
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
      window.dispatchEvent(new CustomEvent('app:open-repo-detail', {
        detail: {
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
        },
      }))
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
      window.dispatchEvent(new CustomEvent('app:open-repo-detail', { detail: {} }))
      window.dispatchEvent(new CustomEvent('app:open-repo-detail', {}))
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
