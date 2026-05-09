import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// -----------------------------------------------------------------------
// Mock DiffRenderer and FileTree — avoids needing useTheme / virtualizer
// contexts. FileTree mock renders buttons so onFileSelect works. The
// "Mark as reviewed" checkbox lives in CodeReviewSurface itself (below
// the FileTree), so we don't need the mock to render it.
// -----------------------------------------------------------------------
vi.mock('../../../src/components/PRReview/DiffPanel/DiffRenderer', () => ({
    DiffRenderer: ({ filename }) => <div data-testid="diff-renderer">{filename}</div>,
}))
vi.mock('../../../src/components/PRReview/FileTree/FileTree', () => ({
    FileTree: ({ files, onFileSelect }) => (
        <ul>
            {files.map(f => (
                <li key={f.filename}>
                    <button onClick={() => onFileSelect(f.filename)}>{f.filename}</button>
                </li>
            ))}
        </ul>
    ),
}))

import { CodeReviewSurface } from '../../../src/components/diff/CodeReviewSurface'

const FILES = [
    { filename: 'a.js', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+a\n+b' },
    { filename: 'b.js', additions: 0, deletions: 1, patch: '@@ -1,1 +0,0 @@\n-x' },
]

describe('CodeReviewSurface', () => {
    beforeEach(() => { localStorage.clear() })

    it('renders the file tree, the toolbar, and the active diff', () => {
        render(<CodeReviewSurface files={FILES} storageKey="test:1" />)
        // Both filenames appear (may appear multiple times in tree + header + diff mock)
        expect(screen.getAllByText('a.js').length).toBeGreaterThan(0)
        expect(screen.getAllByText('b.js').length).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: /Previous file/i })).toBeInTheDocument()
    })

    it('persists viewed state under storageKey', () => {
        const { unmount } = render(<CodeReviewSurface files={FILES} storageKey="test:viewed" />)
        const checkbox = screen.getByLabelText(/Mark as reviewed/i)
        fireEvent.click(checkbox)
        unmount()
        // Re-mount and confirm the box is still checked
        render(<CodeReviewSurface files={FILES} storageKey="test:viewed" />)
        expect(screen.getByLabelText(/Mark as reviewed/i)).toBeChecked()
    })

    it('storageKey scopes viewed state', () => {
        const { unmount } = render(<CodeReviewSurface files={FILES} storageKey="test:A" />)
        fireEvent.click(screen.getByLabelText(/Mark as reviewed/i))
        unmount()
        // Different surface, different key — should NOT be checked
        render(<CodeReviewSurface files={FILES} storageKey="test:B" />)
        expect(screen.getByLabelText(/Mark as reviewed/i)).not.toBeChecked()
    })

    it('omits the right column when rightSlot is null', () => {
        const { container } = render(<CodeReviewSurface files={FILES} storageKey="test:no-right" rightSlot={null} />)
        expect(container.querySelector('[data-testid="code-review-right"]')).toBeNull()
    })

    it('renders headerSlot above the diff column when provided', () => {
        render(<CodeReviewSurface files={FILES} storageKey="test:hs" headerSlot={<div>HEADER</div>} />)
        expect(screen.getByText('HEADER')).toBeInTheDocument()
    })
})
