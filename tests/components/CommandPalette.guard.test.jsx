/*
 * CommandPalette extraction guard — characterization tests.
 *
 * These lock the rendered output + behaviour of the render paths that
 * CommandPalette.test.jsx does NOT exercise, so the upcoming component
 * extraction (SearchInput / AskModeBanner / RecentGroup / GitHubResults /
 * CommandGroup) is provably behaviour-preserving. They intentionally pass
 * against the CURRENT monolith — that is what makes them a refactor safety
 * net (run before, during, and after every extraction).
 *
 * We use explicit structural/behavioural assertions rather than
 * `toMatchSnapshot`: the repo has no snapshot infra, and cmdk + Radix Dialog
 * inject non-deterministic ids that would make raw DOM snapshots flaky.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { emitAppEvent, APP_EVENTS } from '../../src/utils/appEvents'
import { RECENTS_STORAGE_KEY } from '../../src/components/CommandPalette/recents'

vi.mock('@/hooks/useTrackedRepos', () => ({
  useTrackedRepos: () => ({
    repos: [], prefs: {},
    pin: vi.fn(), unpin: vi.fn(), mute: vi.fn(), unmute: vi.fn(),
    untrack: vi.fn(), discover: vi.fn(), refresh: vi.fn(), undo: vi.fn(),
  }),
}))

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() } }),
}))

vi.mock('@/actions/repoActionContext', () => ({
  useRepoActionContext: () => ({
    api: {}, toast: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() },
    openModal: vi.fn(), openModalWithData: vi.fn(), closeModal: vi.fn(),
    refresh: vi.fn(), performAction: vi.fn(), archiveRepos: vi.fn(), deleteRepos: vi.fn(), confirmGate: vi.fn(),
  }),
}))

const mockGithubSearch = vi.fn()
vi.mock('@/api/search', () => ({ searchApi: { github: (...args) => mockGithubSearch(...args) } }))

// Disable MOCK_MODE so the live-search + ask paths aren't short-circuited.
vi.mock('@/config', () => ({ MOCK_MODE: false }))

const mockTranslate = vi.fn()
vi.mock('@/api/translateSearch', () => ({ translateSearch: (...args) => mockTranslate(...args) }))

const { CommandPalette } = await import('@/components/CommandPalette')

const makeRepos = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `repo-${i + 1}`,
    full_name: `owner/repo-${i + 1}`,
    private: false,
    description: null,
    language: null,
    stargazers_count: 0,
  }))

function renderPalette(overrides = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    repos: makeRepos(3),
    activeView: 'repos',
    onViewChange: vi.fn(),
    onOpenModal: vi.fn(),
    onSelectRepo: vi.fn(),
    ...overrides,
  }
  const result = render(<CommandPalette {...props} />)
  return { ...result, props }
}

describe('CommandPalette guard — extraction safety net', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage?.clear?.()
    mockGithubSearch.mockResolvedValue({ prs: [], issues: [], repos: [] })
  })

  // --- CommandGroup wrapper target: the canonical group structure ----------
  it('renders the canonical default group structure (no input)', () => {
    renderPalette()
    expect(screen.getByText('Navigate')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Work Board Actions')).toBeInTheDocument()
    expect(screen.getByText('Your Repositories')).toBeInTheDocument()
    // Footer: no recents seeded -> no "N recent" counter.
    expect(screen.queryByText(/\d+ recent/)).toBeNull()
  })

  // --- SearchInput target: placeholder swaps between command + ask mode -----
  it('swaps the input placeholder when entering ask mode', async () => {
    const user = userEvent.setup()
    renderPalette()
    expect(screen.getByPlaceholderText(/Type a command or search/i)).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/Type a command or search/i), '?')
    expect(await screen.findByPlaceholderText(/Ask anything/i)).toBeInTheDocument()
  })

  // --- GitHubResults target: live search renders PR / Issue / Repo groups ---
  it('renders live GitHub PR, Issue and Repo result groups', async () => {
    mockGithubSearch.mockResolvedValue({
      prs: [{ id: 11, repoFullName: 'acme/payment', title: 'Fix payment race', number: 42, url: 'https://gh/pr/42', state: 'open', draft: false }],
      issues: [{ id: 22, repoFullName: 'acme/payment', title: 'payment double charge', number: 7, url: 'https://gh/issue/7', state: 'open' }],
      repos: [{ id: 33, fullName: 'acme/payment', url: 'https://gh/acme/payment', description: 'payment service', stars: 5 }],
    })
    const user = userEvent.setup()
    renderPalette()
    await user.type(screen.getByPlaceholderText(/Type a command or search/i), 'payment')

    expect(await screen.findByText('Fix payment race', undefined, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText('GitHub — Pull requests')).toBeInTheDocument()
    expect(screen.getByText('GitHub — Issues')).toBeInTheDocument()
    expect(screen.getByText('payment double charge')).toBeInTheDocument()
    expect(screen.getByText('GitHub — Repositories')).toBeInTheDocument()
    expect(screen.getByText('★ 5')).toBeInTheDocument()
    // The live search calls the API with the trimmed query and an abort signal.
    expect(mockGithubSearch).toHaveBeenCalledWith('payment', expect.objectContaining({ type: 'all', limit: 15 }))
  })

  it('selecting a live GitHub PR opens it externally and closes the palette', async () => {
    mockGithubSearch.mockResolvedValue({
      prs: [{ id: 11, repoFullName: 'acme/payment', title: 'Fix payment race', number: 42, url: 'https://gh/pr/42', state: 'open', draft: false }],
      issues: [], repos: [],
    })
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()
    const { props } = renderPalette()
    await user.type(screen.getByPlaceholderText(/Type a command or search/i), 'payment')

    fireEvent.click(await screen.findByText('Fix payment race', undefined, { timeout: 2000 }))
    expect(openSpy).toHaveBeenCalledWith('https://gh/pr/42', '_blank', 'noopener,noreferrer')
    expect(props.onClose).toHaveBeenCalled()
    openSpy.mockRestore()
  })

  // --- RecentGroup target: seeded recents render + drive selection ----------
  it('renders the Recent group and footer counter from persisted recents', () => {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify([
      { kind: 'view', id: 'dashboard', label: 'Dashboard', ts: 2 },
      { kind: 'repo', id: 'owner/repo-12', label: 'owner/repo-12', ts: 1 },
    ]))
    renderPalette({ repos: makeRepos(12) })
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByText('2 recent')).toBeInTheDocument()
  })

  it('selecting a recent repo (outside the top-10 nav cap) calls onSelectRepo and closes', () => {
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify([
      { kind: 'repo', id: 'owner/repo-12', label: 'owner/repo-12', ts: 1 },
    ]))
    const repos = makeRepos(12)
    const { props } = renderPalette({ repos })
    // repo-12 is beyond the 10-item "Your Repositories" cap, so it appears
    // only in the Recent group — a single, unambiguous match.
    fireEvent.click(screen.getByText('owner/repo-12'))
    expect(props.onSelectRepo).toHaveBeenCalledWith(repos[11])
    expect(props.onClose).toHaveBeenCalled()
  })

  // --- prReviewFocused scoping: PR-review group toggles on focus events -----
  it('shows PR-review commands only while a PR review surface is focused', () => {
    renderPalette({ activeView: 'repo-detail' })
    expect(screen.queryByText('Mark current file as reviewed')).toBeNull()

    act(() => { emitAppEvent(APP_EVENTS.PR_REVIEW_FOCUSED) })
    expect(screen.getByText('PR Review')).toBeInTheDocument()
    expect(screen.getByText('Mark current file as reviewed')).toBeInTheDocument()

    act(() => { emitAppEvent(APP_EVENTS.PR_REVIEW_BLURRED) })
    expect(screen.queryByText('Mark current file as reviewed')).toBeNull()
  })
})
