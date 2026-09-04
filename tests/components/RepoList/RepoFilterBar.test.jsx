/*
 * RepoFilterBar — the bulk-selection dropdown was a non-managed menu (no role,
 * no Escape, no focus move, no arrow keys). It is now a proper ARIA menu:
 * role=menu/menuitem, first item focused on open, ArrowUp/Down roving, and
 * Escape closes + returns focus to the trigger.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RepoFilterBar } from '@/components/RepoList/RepoFilterBar'

vi.mock('@/hooks/useMobileBreakpoint', () => ({ useMobileBreakpoint: () => false }))

function renderBar(overrides = {}) {
  render(<RepoFilterBar
    allFilteredSelected={false}
    someFilteredSelected={false}
    hasActiveFilters={false}
    onSelectAll={vi.fn()}
    onInvertSelection={vi.fn()}
    onClearSelection={vi.fn()}
    searchQuery=""
    setSearchQuery={vi.fn()}
    isAISearch={false}
    setIsAISearch={vi.fn()}
    isSearchingAI={false}
    aiSearchError={null}
    viewMode="grid"
    setViewMode={vi.fn()}
    typeFilter="all"
    setTypeFilter={vi.fn()}
    visibilityFilter="all"
    setVisibilityFilter={vi.fn()}
    languageFilter="all"
    setLanguageFilter={vi.fn()}
    availableLanguages={[]}
    onRefresh={vi.fn()}
    loading={false}
    clearAllFilters={vi.fn()}
    totalCount={0}
    filteredCount={0}
    sortBy="name"
    setSortBy={vi.fn()}
    {...overrides}
  />)
}

const openMenu = () => {
  const trigger = screen.getByRole('button', { name: /open selection menu/i })
  fireEvent.click(trigger)
  return trigger
}

describe('RepoFilterBar — bulk selection menu a11y', () => {
  it('opens a labelled role=menu with menuitems and focuses the first item', () => {
    renderBar()
    openMenu()
    expect(screen.getByRole('menu', { name: /bulk selection actions/i })).toBeInTheDocument()
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(3)
    expect(document.activeElement).toBe(items[0])
  })

  it('ArrowDown moves focus to the next item', () => {
    renderBar()
    openMenu()
    const items = screen.getAllByRole('menuitem')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
  })

  it('Escape closes the menu and returns focus to the trigger', () => {
    renderBar()
    const trigger = openMenu()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('exposes aria-haspopup=menu on the trigger', () => {
    renderBar()
    expect(screen.getByRole('button', { name: /open selection menu/i })).toHaveAttribute('aria-haspopup', 'menu')
  })
})

// G5 — saved views on the repositories filter bar. Unit tests run under
// MOCK_MODE (see .env.test), so the underlying useSavedViews hook persists
// to localStorage rather than fetching — no network mocking needed here.
describe('RepoFilterBar — saved views (G5)', () => {
  beforeEach(() => { localStorage.clear() })

  it('does not render the Presets dropdown when onApplySavedView is not provided', () => {
    renderBar()
    expect(screen.queryByRole('button', { name: /presets/i })).toBeNull()
  })

  it('renders the Presets dropdown when onApplySavedView is provided', () => {
    renderBar({ onApplySavedView: vi.fn() })
    expect(screen.getByRole('button', { name: /presets/i })).toBeInTheDocument()
  })

  it('saves the current filters under the "repos" scope and applies a saved view back', async () => {
    const onApply = vi.fn()
    renderBar({ onApplySavedView: onApply, typeFilter: 'fork', sortBy: 'stars' })

    fireEvent.click(screen.getByRole('button', { name: /presets/i }))
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Forks by stars' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await screen.findByText('Forks by stars')
    fireEvent.click(screen.getByText('Forks by stars'))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: 'fork', sort: 'stars' }))

    const stored = JSON.parse(localStorage.getItem('saved-views:repos'))
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('Forks by stars')
  })
})
