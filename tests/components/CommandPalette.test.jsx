import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onAppEvent, APP_EVENTS } from '../../src/utils/appEvents'

// cmdk uses Radix Dialog which uses portals - happy-dom supports this
// We need to mock some things for the dialog environment

vi.mock('@/hooks/useTrackedRepos', () => ({
  useTrackedRepos: () => ({
    repos: [],
    pin: vi.fn(),
    unpin: vi.fn(),
    mute: vi.fn(),
    unmute: vi.fn(),
    untrack: vi.fn(),
    discover: vi.fn(),
    refresh: vi.fn(),
    undo: vi.fn(),
  }),
}))

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() } }),
}))

// Stub the action-registry DI hook so the new "Repo actions" palette group
// can render without dragging ModalProvider / GitHubProvider into the test
// tree. The hook normally chains through useModal + useGitHub which require
// their providers; the palette unit tests focus on rendering + selection,
// not the action mutations themselves.
vi.mock('@/actions/repoActionContext', () => ({
  useRepoActionContext: () => ({
    api: {},
    toast: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() },
    openModal: vi.fn(),
    openModalWithData: vi.fn(),
    closeModal: vi.fn(),
    refresh: vi.fn(),
    performAction: vi.fn(),
    archiveRepos: vi.fn(),
    deleteRepos: vi.fn(),
    confirmGate: vi.fn(),
  }),
}))

vi.mock('@/api/search', () => ({
  searchApi: { github: vi.fn().mockResolvedValue({ prs: [], issues: [], repos: [] }) },
}))

// Disable MOCK_MODE so the live + ask paths aren't short-circuited.
vi.mock('@/config', () => ({ MOCK_MODE: false }))

const mockTranslate = vi.fn()
vi.mock('@/api/translateSearch', () => ({
  translateSearch: (...args) => mockTranslate(...args),
}))

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

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Recents persist in localStorage; isolate per-test so prior bumps
    // don't leak Recent rows into "no repos rendered" assertions.
    window.localStorage?.clear?.()
  })

  it('renders nothing when isOpen is false', () => {
    renderPalette({ isOpen: false })
    // Dialog should not be visible / content not in DOM
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders Navigate, Actions and Repositories sections when isOpen is true', () => {
    renderPalette()
    // Groups should be in the document (group headings are aria-hidden divs with cmdk-group-heading attr)
    expect(screen.getByText('Navigate')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
    // "Repositories" appears both as group heading and as nav item
    expect(screen.getAllByText('Repositories').length).toBeGreaterThanOrEqual(1)
  })

  it('renders Navigate items', () => {
    renderPalette()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    // "Repositories" is both a nav item and a group heading - use getAllByText
    expect(screen.getAllByText('Repositories').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.getByText('Pricing')).toBeInTheDocument()
    // Roadmap left the palette 2026-09-05 with the in-app roadmap page — the
    // roadmap now lives only in ROADMAP.md, linked from the Pricing page.
    expect(screen.queryByText('Roadmap')).toBeNull()
  })

  it('renders Actions items', () => {
    renderPalette()
    expect(screen.getByText('Open Migration Wizard')).toBeInTheDocument()
    expect(screen.getByText('View Migration History')).toBeInTheDocument()
    expect(screen.getByText('Create Repository')).toBeInTheDocument()
    expect(screen.getByText('Transfer Repository')).toBeInTheDocument()
    expect(screen.getByText('Open Settings')).toBeInTheDocument()
  })

  it('renders repo items', () => {
    renderPalette({ repos: makeRepos(3) })
    expect(screen.getByText('owner/repo-1')).toBeInTheDocument()
    expect(screen.getByText('owner/repo-2')).toBeInTheDocument()
    expect(screen.getByText('owner/repo-3')).toBeInTheDocument()
  })

  it('typing "dash" filters to show Dashboard item', async () => {
    const user = userEvent.setup()
    renderPalette()
    const input = screen.getByPlaceholderText(/type a command/i)
    await user.type(input, 'dash')
    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
    // Other navigate items filtered out
    expect(screen.queryByText('Teams')).toBeNull()
  })

  it('selecting Dashboard calls onViewChange("dashboard") and onClose', () => {
    const { props } = renderPalette()
    // Find the Dashboard item and click it
    const dashboardItem = screen.getByText('Dashboard').closest('[cmdk-item]') ||
      screen.getByText('Dashboard')
    fireEvent.click(dashboardItem)
    expect(props.onViewChange).toHaveBeenCalledWith('dashboard')
    expect(props.onClose).toHaveBeenCalled()
  })

  it('selecting "Open Migration Wizard" calls onOpenModal and onClose', async () => {
    const { props } = renderPalette()
    const item = screen.getByText('Open Migration Wizard')
    fireEvent.click(item)
    expect(props.onOpenModal).toHaveBeenCalledWith('showMigrationWizard')
    expect(props.onClose).toHaveBeenCalled()
  })

  it('selecting a repo calls onSelectRepo with that repo and onClose', () => {
    const repos = makeRepos(3)
    const { props } = renderPalette({ repos })
    const item = screen.getByText('owner/repo-1')
    fireEvent.click(item)
    expect(props.onSelectRepo).toHaveBeenCalledWith(repos[0])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('repos array of 20 items — only 10 rendered', () => {
    renderPalette({ repos: makeRepos(20) })
    // The "Your Repositories" navigation group caps at 10. The new "Repo
    // actions" group produces composite labels like "Open Details — owner/repo-1",
    // so we must match the bare full_name only — a navigation item's text is
    // the repo full_name with no surrounding em-dash composition.
    const navLabels = screen.getAllByText(/^owner\/repo-\d+$/)
    expect(navLabels.length).toBe(10)
  })

  it('empty repos array — repositories section is hidden or shows empty state', () => {
    renderPalette({ repos: [] })
    // Either the Repositories group heading is absent, or repo items are absent
    const repoItems = screen.queryAllByText(/owner\/repo-/)
    expect(repoItems.length).toBe(0)
  })

  it('does not render Work Board group when activeView is not "work-board"', () => {
    renderPalette({ activeView: 'repos' })
    expect(screen.queryByText('Work Board', { selector: '[cmdk-group-heading]' })).toBeNull()
    expect(screen.queryByText('Open My Reviews')).toBeNull()
  })

  it('renders Work Board group items when activeView === "work-board"', () => {
    renderPalette({ activeView: 'work-board' })
    expect(screen.getByText('Open My Reviews')).toBeInTheDocument()
    expect(screen.getByText('Open Stale PRs')).toBeInTheDocument()
    expect(screen.getByText('Open My Issues')).toBeInTheDocument()
    expect(screen.getByText('Open Tech Debt')).toBeInTheDocument()
    expect(screen.getByText('Open Review Load')).toBeInTheDocument()
    expect(screen.getByText('Open DORA')).toBeInTheDocument()
    expect(screen.getByText('Regenerate AI summary')).toBeInTheDocument()
    expect(screen.getByText('Save current filters as preset')).toBeInTheDocument()
  })

  it('selecting "Open Tech Debt" dispatches workboard:go-tab with detail "techdebt" and closes', () => {
    const { props } = renderPalette({ activeView: 'work-board' })
    const handler = vi.fn()
    const off = onAppEvent(APP_EVENTS.WORKBOARD_GO_TAB, handler)
    try {
      fireEvent.click(screen.getByText('Open Tech Debt'))
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler.mock.calls[0][0].detail).toBe('techdebt')
      expect(props.onClose).toHaveBeenCalled()
    } finally {
      off()
    }
  })

  it('Esc key calls onClose', () => {
    const { props } = renderPalette()
    fireEvent.keyDown(document.activeElement || document.body, {
      key: 'Escape',
      bubbles: true,
    })
    expect(props.onClose).toHaveBeenCalled()
  })

  describe('Ask mode', () => {
    beforeEach(() => {
      mockTranslate.mockReset().mockResolvedValue({
        summary: 'PRs you need to review.',
        queries: [{ type: 'pr', ghQuery: 'is:pr review-requested:@me' }],
        fallback: false,
      })
    })

    it('shows the "Ask mode" footer label and Sparkles icon when input starts with ?', async () => {
      const user = userEvent.setup()
      renderPalette()
      const input = screen.getByPlaceholderText(/Type a command/i)
      await user.type(input, '?my')
      expect(await screen.findByText('Ask mode')).toBeInTheDocument()
    })

    it('hides the Navigate group when in ask mode', async () => {
      const user = userEvent.setup()
      renderPalette()
      const input = screen.getByPlaceholderText(/Type a command/i)
      // Sanity: Navigate visible before ask mode.
      expect(screen.getByText('Dashboard')).toBeInTheDocument()
      await user.type(input, '?show me my open PRs')
      // Wait for the debounce + render swap.
      await screen.findByText('Ask mode')
      expect(screen.queryByText('Dashboard')).toBeNull()
    })

    it('renders the AI summary once translateSearch resolves', async () => {
      const user = userEvent.setup()
      renderPalette()
      const input = screen.getByPlaceholderText(/Type a command/i)
      await user.type(input, '?show me my open PRs')
      // Debounce 450ms + render swap; allow the test 2s headroom.
      await waitFor(
        () => expect(screen.getByText(/PRs you need to review/i)).toBeInTheDocument(),
        { timeout: 2000 },
      )
    })

    it('does not call translateSearch for queries shorter than ASK_MIN_LEN', async () => {
      const user = userEvent.setup()
      renderPalette()
      const input = screen.getByPlaceholderText(/Type a command/i)
      await user.type(input, '?ab')
      // Wait past the debounce window.
      await new Promise((r) => setTimeout(r, 600))
      expect(mockTranslate).not.toHaveBeenCalled()
    })
  })
})
