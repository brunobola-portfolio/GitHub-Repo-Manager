import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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

vi.mock('@/hooks/useResilientFetch', () => ({
    useResilientFetch: () => ({
        data: COMMITS,
        loading: false,
        error: null,
        stale: false,
        fetchedAt: null,
        reload: vi.fn(),
    }),
}))

vi.mock('@/components/RepoDetail/CommitDetailPanel', () => ({
    CommitDetailPanel: ({ sha, onClose }) => (
        <div data-testid="commit-detail-stub" data-sha={sha}>
            <button onClick={onClose}>Close</button>
        </div>
    ),
}))

const repo = { owner: { login: 'owner' }, name: 'repo', full_name: 'owner/repo' }

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('CommitsTab — accessible row structure', () => {
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
