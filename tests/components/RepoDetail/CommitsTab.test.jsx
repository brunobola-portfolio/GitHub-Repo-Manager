import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommitsTab } from '@/components/RepoDetail/CommitsTab'

const COMMITS = [
    {
        sha: 'abc1234567890',
        html_url: 'https://github.com/owner/repo/commit/abc1234567890',
        author: { login: 'octocat', avatar_url: 'https://example.com/a.png' },
        commit: {
            message: 'feat: shiny\n\nLonger body describing the change',
            author: { date: '2026-04-10T00:00:00Z' },
        },
    },
]

// Page-aware commit fixtures for the pagination tests: page 1 returns a
// full page (50) so "Load more" appears; page 2 returns a partial page so
// it disappears again once exhausted.
function makeCommits(count, prefix) {
    return Array.from({ length: count }, (_, i) => ({
        sha: `${prefix}${i}`,
        html_url: `https://github.com/owner/repo/commit/${prefix}${i}`,
        author: { login: 'octocat', avatar_url: 'https://example.com/a.png' },
        commit: {
            message: `commit ${prefix}${i}`,
            author: { date: '2026-04-10T00:00:00Z' },
        },
    }))
}
const PAGE_1 = makeCommits(50, 'page1-')
const PAGE_2 = makeCommits(3, 'page2-')

function pageFromPath(path) {
    const match = path.match(/[?&]page=(\d+)/)
    return match ? Number(match[1]) : 1
}

const { mockUseResilientFetch } = vi.hoisted(() => ({ mockUseResilientFetch: vi.fn() }))

vi.mock('@/hooks/useResilientFetch', () => ({
    useResilientFetch: (...args) => mockUseResilientFetch(...args),
}))

vi.mock('@/components/RepoDetail/CommitDetailPanel', () => ({
    CommitDetailPanel: ({ sha, onClose }) => (
        <div data-testid="commit-detail-stub" data-sha={sha}>
            <button onClick={onClose}>Close</button>
        </div>
    ),
}))

const repo = { owner: { login: 'owner' }, name: 'repo', full_name: 'owner/repo' }

beforeEach(() => {
    // Every test starts from a clean, param-free URL — deep-link state must
    // never leak across tests (or across real navigations, which is exactly
    // what CommitsTab's own cleanup on close guards against).
    window.history.replaceState({}, '', '/')
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
})

describe('CommitsTab — accessible row structure', () => {
    beforeEach(() => {
        mockUseResilientFetch.mockReturnValue({
            data: COMMITS,
            loading: false,
            error: null,
            stale: false,
            fetchedAt: null,
            reload: vi.fn(),
        })
    })

    it('opens via a real message button, not a button wrapping the external-link anchor', async () => {
        render(<CommitsTab repo={repo} />)

        // The row's primary control is a real <button> carrying a stable
        // "Open commit <sha>: <message>" name, instead of a <motion.button>
        // wrapping an <a target="_blank"> (the nested-interactive axe violation).
        const opener = await screen.findByRole('button', { name: /Open commit abc1234: feat: shiny/i })
        expect(opener.tagName).toBe('BUTTON')

        const link = screen.getByRole('link', { name: /open on github/i })
        // The anchor must be a sibling control, not nested inside the row's
        // button — that nested-interactive shape is exactly what axe flagged.
        expect(opener.contains(link)).toBe(false)
        expect(link.contains(opener)).toBe(false)
    })

    it('clicking the message button opens the commit detail panel', async () => {
        const user = userEvent.setup()
        render(<CommitsTab repo={repo} />)

        const opener = await screen.findByRole('button', { name: /Open commit abc1234: feat: shiny/i })
        await user.click(opener)

        expect(await screen.findByTestId('commit-detail-stub')).toBeInTheDocument()
    })

    it('the external-link anchor still opens GitHub in a new tab without opening the detail panel', async () => {
        const user = userEvent.setup()
        render(<CommitsTab repo={repo} />)

        const link = await screen.findByRole('link', { name: /open on github/i })
        expect(link).toHaveAttribute('href', COMMITS[0].html_url)
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))

        // jsdom can't navigate — suppress only the default action so the click
        // still BUBBLES normally and the isolation assertion below stays
        // meaningful: with the anchor nested inside the row button (the old
        // markup) and no stopPropagation, this click would bubble into the
        // button's onClick and open the detail panel.
        link.addEventListener('click', (e) => e.preventDefault())
        await user.click(link)

        // Clicking the anchor must not also trigger the row's onOpen — the
        // anchor is a sibling of the row button, so no bubbling reaches it.
        expect(screen.queryByTestId('commit-detail-stub')).not.toBeInTheDocument()
    })
})

describe('CommitsTab — pagination', () => {
    beforeEach(() => {
        mockUseResilientFetch.mockImplementation((path) => {
            const page = pageFromPath(path)
            return {
                data: page === 1 ? PAGE_1 : PAGE_2,
                loading: false,
                error: null,
                stale: false,
                fetchedAt: null,
                reload: vi.fn(),
            }
        })
    })

    it('shows a "Load more" affordance when a full page comes back', async () => {
        render(<CommitsTab repo={repo} />)
        expect(await screen.findByRole('button', { name: /load more commits/i })).toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /^Open commit/i })).toHaveLength(50)
    })

    it('appends the next page on click and hides the button once the page is short', async () => {
        const user = userEvent.setup()
        render(<CommitsTab repo={repo} />)

        const loadMore = await screen.findByRole('button', { name: /load more commits/i })
        await user.click(loadMore)

        // Page 1's commits are still present alongside page 2's.
        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /^Open commit/i })).toHaveLength(53)
        })
        expect(screen.getByText('commit page1-0')).toBeInTheDocument()
        expect(screen.getByText('commit page2-0')).toBeInTheDocument()
        // Page 2 only had 3 (< PER_PAGE), so there's nothing more to load.
        expect(screen.queryByRole('button', { name: /load more commits/i })).not.toBeInTheDocument()
    })

    it('offers a retry (not silent skip-ahead) when loading the next page fails', async () => {
        mockUseResilientFetch.mockImplementation((path) => {
            const page = pageFromPath(path)
            if (page === 1) {
                return { data: PAGE_1, loading: false, error: null, stale: false, fetchedAt: null, reload: vi.fn() }
            }
            // Page 2 failed — useResilientFetch keeps the last-good `data`
            // (still page 1's array) while surfacing `error`.
            return { data: PAGE_1, loading: false, error: { status: 500 }, stale: false, fetchedAt: null, reload: vi.fn() }
        })

        const user = userEvent.setup()
        render(<CommitsTab repo={repo} />)

        const loadMore = await screen.findByRole('button', { name: /load more commits/i })
        await user.click(loadMore)

        expect(await screen.findByText(/couldn.t load more commits/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
        // The failed page's commits must not have been merged in as if it succeeded.
        expect(screen.getAllByRole('button', { name: /^Open commit/i })).toHaveLength(50)
    })
})

describe('CommitsTab — deep-linking', () => {
    beforeEach(() => {
        mockUseResilientFetch.mockReturnValue({
            data: COMMITS,
            loading: false,
            error: null,
            stale: false,
            fetchedAt: null,
            reload: vi.fn(),
        })
    })

    it('opens the commit named in ?commit=<sha> on mount', async () => {
        window.history.replaceState({}, '', `/?commit=${COMMITS[0].sha}`)
        render(<CommitsTab repo={repo} />)

        const panel = await screen.findByTestId('commit-detail-stub')
        expect(panel).toHaveAttribute('data-sha', COMMITS[0].sha)
    })

    it('opening a commit writes its sha into the URL', async () => {
        const user = userEvent.setup()
        render(<CommitsTab repo={repo} />)

        const opener = await screen.findByRole('button', { name: /Open commit abc1234: feat: shiny/i })
        await user.click(opener)

        expect(new URLSearchParams(window.location.search).get('commit')).toBe(COMMITS[0].sha)
    })

    it('closing the commit strips the sha back out of the URL', async () => {
        const user = userEvent.setup()
        render(<CommitsTab repo={repo} />)

        await user.click(await screen.findByRole('button', { name: /Open commit abc1234: feat: shiny/i }))
        expect(new URLSearchParams(window.location.search).get('commit')).toBe(COMMITS[0].sha)

        await user.click(screen.getByText('Close'))
        expect(new URLSearchParams(window.location.search).get('commit')).toBeNull()
    })

    it('browser back closes an open commit', async () => {
        const user = userEvent.setup()
        render(<CommitsTab repo={repo} />)

        await user.click(await screen.findByRole('button', { name: /Open commit abc1234: feat: shiny/i }))
        expect(await screen.findByTestId('commit-detail-stub')).toBeInTheDocument()

        // Simulate the browser handling "back" itself (reverting the URL)
        // before notifying the app via popstate — CommitsTab only listens,
        // it never calls history.back() itself.
        act(() => {
            window.history.replaceState({}, '', '/')
            window.dispatchEvent(new PopStateEvent('popstate'))
        })

        expect(screen.queryByTestId('commit-detail-stub')).not.toBeInTheDocument()
    })
})
