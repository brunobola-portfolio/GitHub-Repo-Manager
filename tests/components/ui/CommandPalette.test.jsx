import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommandPalette } from '../../../src/components/ui/CommandPalette'

describe('CommandPalette', () => {
  it('opens on ⌘K and closes on Escape', () => {
    render(<CommandPalette commands={[{ id: 'sync', label: 'Sync now', run: () => {} }]} />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument()
  })

  it('filters commands by the typed query', () => {
    render(<CommandPalette commands={[
      { id: 'sync', label: 'Sync now', run: () => {} },
      { id: 'toggle', label: 'Toggle theme', run: () => {} },
    ]} />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'sync' } })
    expect(screen.getByText('Sync now')).toBeInTheDocument()
    expect(screen.queryByText('Toggle theme')).not.toBeInTheDocument()
  })

  it('invokes run() on ↵', () => {
    const run = vi.fn()
    render(<CommandPalette commands={[{ id: 'sync', label: 'Sync now', run }]} />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.keyDown(screen.getByPlaceholderText(/search/i), { key: 'Enter' })
    expect(run).toHaveBeenCalled()
  })
})
