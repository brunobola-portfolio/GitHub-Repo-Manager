import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileTree } from '@/components/PRReview/FileTree/FileTree'

// Render every row so the tree semantics + keyboard nav are testable: happy-dom
// has no layout, so the real virtualizer would measure 0 height and render
// nothing. This mock yields all items at fixed offsets.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getTotalSize: () => count * 32,
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, key: i, start: i * 32, size: 32 })),
    scrollToIndex: vi.fn(),
  }),
}))

const FILES = [
  { filename: 'src/a.js', additions: 1, deletions: 0, status: 'modified' },
  { filename: 'src/b.js', additions: 2, deletions: 1, status: 'added' },
  { filename: 'src/c.js', additions: 0, deletions: 3, status: 'removed' },
]

const renderTree = (props = {}) => render(<FileTree files={FILES} onFileSelect={vi.fn()} {...props} />)

describe('FileTree — virtualized tree a11y + keyboard nav', () => {
  it('is a single-tab-stop tree whose treeitems carry posinset/setsize/level', () => {
    renderTree()
    const tree = screen.getByRole('tree', { name: /changed files/i })
    expect(tree).toHaveAttribute('tabindex', '0')
    const items = screen.getAllByRole('treeitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveAttribute('aria-posinset', '1')
    expect(items[0]).toHaveAttribute('aria-setsize', '3')
    expect(items[0]).toHaveAttribute('aria-level', '1')
    expect(items.every((i) => i.getAttribute('tabindex') === '-1')).toBe(true)
  })

  it('points aria-activedescendant at the first item and moves it with Arrow/Home/End', () => {
    renderTree()
    const tree = screen.getByRole('tree')
    const items = screen.getAllByRole('treeitem')
    expect(tree.getAttribute('aria-activedescendant')).toBe(items[0].id)

    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(tree.getAttribute('aria-activedescendant')).toBe(items[1].id)

    fireEvent.keyDown(tree, { key: 'End' })
    expect(tree.getAttribute('aria-activedescendant')).toBe(items[2].id)

    fireEvent.keyDown(tree, { key: 'ArrowUp' })
    expect(tree.getAttribute('aria-activedescendant')).toBe(items[1].id)

    fireEvent.keyDown(tree, { key: 'Home' })
    expect(tree.getAttribute('aria-activedescendant')).toBe(items[0].id)
  })

  it('does not move past the last item', () => {
    renderTree()
    const tree = screen.getByRole('tree')
    const items = screen.getAllByRole('treeitem')
    fireEvent.keyDown(tree, { key: 'End' })
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(tree.getAttribute('aria-activedescendant')).toBe(items[2].id)
  })

  it('Enter selects the active-descendant file', () => {
    const onFileSelect = vi.fn()
    renderTree({ onFileSelect })
    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'ArrowDown' }) // -> src/b.js
    fireEvent.keyDown(tree, { key: 'Enter' })
    expect(onFileSelect).toHaveBeenCalledWith('src/b.js')
  })
})
