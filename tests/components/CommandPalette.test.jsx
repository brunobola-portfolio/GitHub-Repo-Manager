import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from '@/components/CommandPalette'

// cmdk uses Radix Dialog which uses portals - happy-dom supports this
// We need to mock some things for the dialog environment

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
    expect(screen.getByText('Roadmap')).toBeInTheDocument()
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

  it('selecting Dashboard calls onViewChange("dashboard") and onClose', async () => {
    const user = userEvent.setup()
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
    // Repositories section should only show 10
    const repoItems = screen.getAllByText(/owner\/repo-/)
    expect(repoItems.length).toBe(10)
  })

  it('empty repos array — repositories section is hidden or shows empty state', () => {
    renderPalette({ repos: [] })
    // Either the Repositories group heading is absent, or repo items are absent
    const repoItems = screen.queryAllByText(/owner\/repo-/)
    expect(repoItems.length).toBe(0)
  })

  it('Esc key calls onClose', () => {
    const { props } = renderPalette()
    fireEvent.keyDown(document.activeElement || document.body, {
      key: 'Escape',
      bubbles: true,
    })
    expect(props.onClose).toHaveBeenCalled()
  })
})
