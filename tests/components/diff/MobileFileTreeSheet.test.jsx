import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// Stub FileTree — its virtualizer needs measurable DOM (jsdom returns 0
// dimensions, so rows never render). We test MobileFileTreeSheet's job:
// wrap FileTree in a Modal-sheet and intercept onFileSelect to also close.
vi.mock('@/components/PRReview/FileTree/FileTree', () => ({
    FileTree: ({ files, onFileSelect }) => (
        <div data-testid="file-tree-stub">
            {files.map(f => (
                <button key={f.filename} onClick={() => onFileSelect?.(f.filename)}>
                    {f.filename}
                </button>
            ))}
        </div>
    ),
}))

import { MobileFileTreeSheet } from '@/components/diff/MobileFileTreeSheet'

afterEach(() => cleanup())

const FILES = [
    { filename: 'src/a.js', additions: 10, deletions: 2 },
    { filename: 'src/b.js', additions: 5, deletions: 0 },
]

describe('MobileFileTreeSheet', () => {
    it('renders the file list inside a modal-sheet container when open', () => {
        render(
            <MobileFileTreeSheet
                isOpen={true}
                onClose={vi.fn()}
                files={FILES}
                activeFile="src/a.js"
                reviewedFiles={[]}
                onFileSelect={vi.fn()}
            />,
        )
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(screen.getByText('src/a.js')).toBeInTheDocument()
        expect(screen.getByText('src/b.js')).toBeInTheDocument()
    })

    it('calls onFileSelect then onClose when a file is picked', () => {
        const onClose = vi.fn()
        const onFileSelect = vi.fn()
        render(
            <MobileFileTreeSheet
                isOpen={true}
                onClose={onClose}
                files={FILES}
                activeFile="src/a.js"
                reviewedFiles={[]}
                onFileSelect={onFileSelect}
            />,
        )
        fireEvent.click(screen.getByText('src/b.js'))
        expect(onFileSelect).toHaveBeenCalledWith('src/b.js')
        expect(onClose).toHaveBeenCalled()
    })

    it('renders nothing when isOpen is false', () => {
        render(
            <MobileFileTreeSheet
                isOpen={false}
                onClose={vi.fn()}
                files={FILES}
                activeFile="src/a.js"
                reviewedFiles={[]}
                onFileSelect={vi.fn()}
            />,
        )
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
})
