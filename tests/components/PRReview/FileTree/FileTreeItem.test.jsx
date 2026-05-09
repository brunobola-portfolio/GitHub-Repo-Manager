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
