import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// Mock the heavy useGitHub composite hook so App's initial render does not
// trigger any real network calls. We return the exact shape AppContent
// destructures in src/App.jsx — missing keys would mask render bugs.
vi.mock('../src/hooks/useGitHub', () => ({
  useGitHub: () => ({
    repos: [],
    user: null,
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

vi.mock('../src/api/teams', () => ({
  listTeams: vi.fn().mockResolvedValue({ teams: [] }),
  createTeam: vi.fn(),
  deleteTeam: vi.fn(),
}))

// AppContent kicks off /api/system/status and /api/auth/me during mount.
// We short-circuit window.fetch so those requests don't hang in happy-dom.
beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    })
  )
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

describe('App smoke', () => {
  it('renders AppContent without TDZ or hook-ordering errors', async () => {
    // This test exists specifically to catch render-time failures such as
    // "Cannot access X before initialization" (temporal dead zone). If a
    // useMemo/useCallback declaration is moved below a hook that reads it,
    // this test fails where ESLint cannot.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(renderApp()).resolves.toBeTruthy()

    // React re-throws render errors through console.error before the test
    // framework sees them; surface any ReferenceError as a hard failure.
    const calls = errorSpy.mock.calls.flat().map(String).join('\n')
    expect(calls).not.toMatch(/Cannot access .* before initialization/)
    expect(calls).not.toMatch(/ReferenceError/)

    errorSpy.mockRestore()
    cleanup()
  })
})
