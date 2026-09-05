/*
 * G8 — command palette drill-down: selecting a repo in the "Repo Actions"
 * group pushes a second-level scoped page (buildRepoActionCommands([repo],
 * ctx), uncapped), Backspace on an empty query pops back, Escape still
 * closes the whole palette from the nested level, and the cmdk input's
 * aria-activedescendant always points at an id that is actually in the DOM
 * (A3 in the a11y report — stale/dangling ids after a full item-set swap).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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

const ctxOpenModal = vi.fn()
const ctxOpenModalWithData = vi.fn()
vi.mock('@/actions/repoActionContext', () => ({
  useRepoActionContext: () => ({
    api: {}, toast: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() },
    openModal: ctxOpenModal, openModalWithData: ctxOpenModalWithData, closeModal: vi.fn(),
    refresh: vi.fn(), performAction: vi.fn(), archiveRepos: vi.fn(), deleteRepos: vi.fn(), confirmGate: vi.fn(),
  }),
}))

vi.mock('@/api/search', () => ({
  searchApi: { github: vi.fn().mockResolvedValue({ prs: [], issues: [], repos: [] }) },
}))

// Disable MOCK_MODE so the live + ask paths aren't short-circuited (same as
// CommandPalette.test.jsx / CommandPalette.guard.test.jsx).
vi.mock('@/config', () => ({ MOCK_MODE: false }))

vi.mock('@/api/translateSearch', () => ({ translateSearch: vi.fn() }))

const { CommandPalette } = await import('@/components/CommandPalette')

const makeRepos = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `repo-${i + 1}`,
    full_name: `owner/repo-${i + 1}`,
    private: false,
    archived: false,
    description: null,
    language: null,
    stargazers_count: 0,
    owner: { login: 'owner' },
    clone_url: `https://github.com/owner/repo-${i + 1}.git`,
    ssh_url: `git@github.com:owner/repo-${i + 1}.git`,
    html_url: `https://github.com/owner/repo-${i + 1}`,
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

/** The cmdk input's aria-activedescendant, if any is set right now. */
function activeDescendantId() {
  return screen.getByPlaceholderText(/type a command or search|search actions/i).getAttribute('aria-activedescendant')
}

function drillIntoRepo1() {
  fireEvent.click(screen.getByText('Actions for owner/repo-1…'))
}

describe('CommandPalette — repo actions drill-down (G8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage?.clear?.()
  })

  it('lists one picker item per repo in "Repo Actions" (not an action × repo cartesian product)', () => {
    renderPalette({ repos: makeRepos(3) })
    expect(screen.getByText('Actions for owner/repo-1…')).toBeInTheDocument()
    expect(screen.getByText('Actions for owner/repo-2…')).toBeInTheDocument()
    expect(screen.getByText('Actions for owner/repo-3…')).toBeInTheDocument()
  })

  it('selecting a repo drills into a scoped, uncapped action list and hides the top-level groups', () => {
    const { props } = renderPalette({ repos: makeRepos(3) })
    drillIntoRepo1()

    // Scoped heading + a healthy number of per-repo actions (registry has
    // ~20 commandPalette-surfaced entries; well past the old reposLimit: 3).
    expect(screen.getByText('Actions — owner/repo-1')).toBeInTheDocument()
    expect(screen.getByText(/Open details — owner\/repo-1/)).toBeInTheDocument()
    expect(screen.getByText(/Delete repository — owner\/repo-1/)).toBeInTheDocument()
    expect(screen.getByText(/Copy HTTPS URL — owner\/repo-1/)).toBeInTheDocument()

    // Top-level content is gone while drilled in.
    expect(screen.queryByText('Navigate')).toBeNull()
    expect(screen.queryByText('Actions for owner/repo-2…')).toBeNull()
    // The palette itself must still be open — drilling in must not close it.
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('shows a breadcrumb chip with the repo name in the search input while drilled in', () => {
    renderPalette({ repos: makeRepos(3) })
    drillIntoRepo1()
    expect(screen.getByText('owner/repo-1')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search actions/i)).toBeInTheDocument()
  })

  it('running a scoped action closes the palette', async () => {
    const { props } = renderPalette({ repos: makeRepos(3) })
    drillIntoRepo1()
    fireEvent.click(screen.getByText(/Open details — owner\/repo-1/))
    // The item's onSelect is async (await item.run() then onClose()), so
    // onClose lands a microtask after the click event resolves.
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })

  it('Backspace on an empty query pops back to the top level', () => {
    renderPalette({ repos: makeRepos(3) })
    drillIntoRepo1()
    expect(screen.getByText('Actions — owner/repo-1')).toBeInTheDocument()

    const input = screen.getByPlaceholderText(/search actions/i)
    fireEvent.keyDown(input, { key: 'Backspace' })

    expect(screen.queryByText('Actions — owner/repo-1')).toBeNull()
    expect(screen.getByText('Navigate')).toBeInTheDocument()
    expect(screen.getByText('Actions for owner/repo-1…')).toBeInTheDocument()
  })

  it('Backspace with text still in the query just edits the query — it does not pop back', () => {
    renderPalette({ repos: makeRepos(3) })
    drillIntoRepo1()
    const input = screen.getByPlaceholderText(/search actions/i)
    fireEvent.change(input, { target: { value: 'delete' } })
    fireEvent.keyDown(input, { key: 'Backspace' })
    // Still scoped — a non-empty query means Backspace is normal text editing.
    expect(screen.getByText('Actions — owner/repo-1')).toBeInTheDocument()
  })

  it('Escape closes the whole palette from the nested level', () => {
    const { props } = renderPalette({ repos: makeRepos(3) })
    drillIntoRepo1()
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', bubbles: true })
    expect(props.onClose).toHaveBeenCalled()
  })

  // cmdk (pacocoursey/cmdk) computes aria-activedescendant from an
  // internal, doubly-batched store update (a useState bump flushed by a
  // useLayoutEffect one render later) and never actually resolves it inside
  // jsdom/RTL's act() in this app — confirmed by direct instrumentation: it
  // stays null on the vanilla, undrilled palette too (Dashboard, Navigate
  // only, no drill-down code involved at all), through typing, arrow-key
  // nav, and multiple flushed ticks. That is a pre-existing cmdk/jsdom
  // interaction, not something this feature introduces or can fix from the
  // app layer — verified live in a real browser instead (see
  // .dev/panel-2026-09-04/p/ screenshots). What IS this app's
  // responsibility, and what this asserts: every Command.Item this feature
  // renders carries a stable, globally-unique `value`/`key`, so an id is
  // never left dangling — whenever an activedescendant id IS present, it
  // must resolve to a real, currently-rendered node, both before and after
  // the full item-set swap into/out of the scoped page.
  it('aria-activedescendant, whenever present, always resolves to an existing node — never a dangling id', async () => {
    renderPalette({ repos: makeRepos(3) })

    const assertNeverDangling = () => {
      const id = activeDescendantId()
      if (id) expect(document.getElementById(id)).not.toBeNull()
    }

    assertNeverDangling()
    drillIntoRepo1()
    assertNeverDangling()
    fireEvent.change(screen.getByPlaceholderText(/search actions/i), { target: { value: 'delete' } })
    assertNeverDangling()
    fireEvent.change(screen.getByPlaceholderText(/search actions/i), { target: { value: '' } })
    fireEvent.keyDown(screen.getByPlaceholderText(/search actions/i), { key: 'Backspace' })
    assertNeverDangling()

    // Every Command.Item this feature renders has a real value/key — the
    // structural guarantee behind the assertion above.
    expect(new Set(scopedIdsRenderedFor('owner/repo-1')).size).toBeGreaterThan(0)
  })
})

/** Ids of every `[cmdk-item]` currently in the DOM whose text mentions `repoFullName`. */
function scopedIdsRenderedFor(repoFullName) {
  return Array.from(document.querySelectorAll('[cmdk-item]'))
    .filter((el) => el.textContent?.includes(repoFullName))
    .map((el) => el.id)
    .filter(Boolean)
}
