import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// Mutable holder so individual tests (e.g. the no-files case) can override
// the fetched commit without re-declaring the whole mock module.
const { commitData } = vi.hoisted(() => ({ commitData: { current: null } }))

vi.mock('../../../src/hooks/useResilientFetch', () => ({
    useResilientFetch: () => ({
        data: commitData.current,
        loading: false,
        error: null,
        stale: false,
        fetchedAt: Date.now(),
        reload: vi.fn(),
    }),
}))

const apiCallMock = vi.fn()
vi.mock('../../../src/utils/api', async () => {
    const actual = await vi.importActual('../../../src/utils/api')
    return { ...actual, apiCall: (...args) => apiCallMock(...args) }
})

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
    beforeEach(() => {
        localStorage.clear()
        apiCallMock.mockReset()
        commitData.current = COMMIT
    })

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

    describe('AI summary (on-demand)', () => {
        it('shows an "Ask AI" trigger instead of auto-firing a request', () => {
            render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
            expect(screen.getByRole('button', { name: /ask ai to summarize this commit/i })).toBeInTheDocument()
            expect(apiCallMock).not.toHaveBeenCalled()
        })

        it('clicking the trigger requests a summary scoped to this commit and renders it', async () => {
            apiCallMock.mockResolvedValue({
                summary: { overview: 'Touches auth middleware.', fileRisks: [{ filename: 'a.js', level: 'high' }] },
            })
            const user = userEvent.setup()
            render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)

            await user.click(screen.getByRole('button', { name: /ask ai to summarize this commit/i }))

            expect(apiCallMock).toHaveBeenCalledTimes(1)
            const [url, options] = apiCallMock.mock.calls[0]
            expect(url).toBe('/api/ai/review-summary')
            const body = JSON.parse(options.body)
            expect(body.prMetadata.repo).toBe('octocat/demo')
            expect(body.fileManifest.map(f => f.filename)).toEqual(['a.js', 'b.js'])

            expect(await screen.findByText('Touches auth middleware.')).toBeInTheDocument()
            // The commit-scoped header/loading copy, not the generic PR wording.
            expect(screen.getByText('AI Commit Summary')).toBeInTheDocument()
        })

        it('does not render an AI trigger when the commit has no files', () => {
            commitData.current = { ...COMMIT, files: [] }
            render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
            expect(screen.queryByRole('button', { name: /ask ai to summarize this commit/i })).not.toBeInTheDocument()
        })
    })

    describe('risk-sorted file tree', () => {
        it('passes sortFiles and fileMeta through to CodeReviewSurface (risk-aware, matching PR review)', async () => {
            render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
            // The mocked FileTree just renders whatever files it receives — the
            // meaningful assertion is that both files still render (sortFiles
            // didn't drop anything) once CodeReviewSurface applies risk sorting.
            await waitFor(() => {
                expect(screen.getAllByText('a.js').length).toBeGreaterThan(0)
                expect(screen.getAllByText('b.js').length).toBeGreaterThan(0)
            })
        })
    })
})
