import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FileTreeItem } from '@/components/PRReview/FileTree/FileTreeItem'

afterEach(() => cleanup())

const FILE = { filename: 'src/a.js', additions: 12, deletions: 3, status: 'modified' }

describe('FileTreeItem — viewed marker animation', () => {
    it('renders the reviewed marker with the data-reviewed-marker hook', () => {
        const { container } = render(
            <FileTreeItem file={FILE} isActive={false} isReviewed={true} onClick={vi.fn()} />,
        )
        expect(container.querySelector('[data-reviewed-marker="true"]')).not.toBeNull()
    })

    it('does NOT render the marker when isReviewed is false', () => {
        const { container } = render(
            <FileTreeItem file={FILE} isActive={false} isReviewed={false} onClick={vi.fn()} />,
        )
        expect(container.querySelector('[data-reviewed-marker="true"]')).toBeNull()
    })

    it('still renders filename, additions and deletions', () => {
        render(<FileTreeItem file={FILE} isActive={false} isReviewed={true} onClick={vi.fn()} />)
        expect(screen.getByText('a.js')).toBeInTheDocument()
        expect(screen.getByText('+12')).toBeInTheDocument()
        expect(screen.getByText('-3')).toBeInTheDocument()
    })
})

describe('FileTreeItem — treeitem a11y semantics', () => {
    it('is a tabIndex=-1 treeitem with level/posinset/setsize + id (aria-activedescendant target)', () => {
        render(
            <FileTreeItem
                file={FILE} id="tree-item-2" isActive isFocused
                isReviewed={false} posInSet={3} setSize={42} onClick={vi.fn()}
            />,
        )
        const item = screen.getByRole('treeitem')
        expect(item).toHaveAttribute('id', 'tree-item-2')
        expect(item).toHaveAttribute('tabindex', '-1')
        expect(item).toHaveAttribute('aria-level', '1')
        expect(item).toHaveAttribute('aria-posinset', '3')
        expect(item).toHaveAttribute('aria-setsize', '42')
        expect(item).toHaveAttribute('aria-selected', 'true')
    })

    it('marks aria-selected=false when not active', () => {
        render(<FileTreeItem file={FILE} isActive={false} isReviewed={false} onClick={vi.fn()} />)
        expect(screen.getByRole('treeitem')).toHaveAttribute('aria-selected', 'false')
    })
})
