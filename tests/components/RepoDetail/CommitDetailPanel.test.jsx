import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommitDetailPanel } from '../../../src/components/RepoDetail/CommitDetailPanel'

const COMMIT = {
    sha: 'abc123def4567',
    html_url: 'https://github.com/octocat/demo/commit/abc123def4567',
    commit: {
        message: 'feat: shiny\n\nLong description\nspanning lines',
        author: { name: 'Alice', date: '2026-05-08T10:00:00Z' },
    },
    stats: { additions: 7, deletions: 3 },
    files: [
        { filename: 'a.js', additions: 5, deletions: 1, patch: '@@ -1,1 +1,1 @@\n-old\n+new' },
        { filename: 'b.js', additions: 2, deletions: 2, patch: '@@ -1,2 +1,2 @@\n-x\n-y\n+a\n+b' },
    ],
}

vi.mock('../../../src/hooks/useResilientFetch', () => ({
    useResilientFetch: () => ({
        data: COMMIT,
        loading: false,
        error: null,
        stale: false,
        fetchedAt: Date.now(),
        reload: vi.fn(),
    }),
}))

// Mock heavy diff/tree internals — same approach used in CodeReviewSurface tests.
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

describe('CommitDetailPanel', () => {
    beforeEach(() => { localStorage.clear() })

    it('renders the commit subject in the modal header', () => {
        render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
        expect(screen.getByText('feat: shiny')).toBeInTheDocument()
    })

    it('renders the file tree with both commit files', () => {
        render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
        expect(screen.getAllByText('a.js').length).toBeGreaterThan(0)
        expect(screen.getAllByText('b.js').length).toBeGreaterThan(0)
    })

    it('persists viewed state under a sha-scoped key', () => {
        const { unmount } = render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
        fireEvent.click(screen.getByLabelText(/Mark as reviewed/i))
        unmount()
        render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
        expect(screen.getByLabelText(/Mark as reviewed/i)).toBeChecked()
    })
})
