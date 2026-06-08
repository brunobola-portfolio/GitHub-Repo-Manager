/*
 * RepoFilterBar — the bulk-selection dropdown was a non-managed menu (no role,
 * no Escape, no focus move, no arrow keys). It is now a proper ARIA menu:
 * role=menu/menuitem, first item focused on open, ArrowUp/Down roving, and
 * Escape closes + returns focus to the trigger.
 */
import { describe, it, expect, vi } from 'vitest'
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
