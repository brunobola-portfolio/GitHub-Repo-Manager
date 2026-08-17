import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RepoCard } from '@/components/RepoList/RepoCard'

// Isolate the card from its data hooks so the test asserts structure/behaviour,
// not network state. TrackedDot / MigratedPill / RepoHealthBadge all render
// nothing with these empty returns.
vi.mock('@/hooks/useRepoMetadata', () => ({
    useRepoMetadata: () => ({ get: () => null, loading: false, map: new Map() }),
    invalidateRepoMetadata: vi.fn(),
}))
vi.mock('@/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => ({ repos: [] }),
}))
vi.mock('@/hooks/useMigratedRepos', () => ({
    useMigratedRepos: () => ({ get: () => null, loading: false }),
}))

const repo = {
    id: 1,
    name: 'fintech-dashboard',
    full_name: 'octo/fintech-dashboard',
    owner: { login: 'octo' },
    description: 'A dashboard',
    language: 'JavaScript',
    private: true,
    archived: false,
    stargazers_count: 3,
    forks_count: 1,
    open_issues_count: 0,
    pushed_at: '2026-04-10T00:00:00Z',
    updated_at: '2026-04-10T00:00:00Z',
}

function renderCard(props = {}) {
    return render(
        <RepoCard
            repo={repo}
            viewMode="grid"
            isSelected={false}
            isContextTarget={false}
            onToggle={props.onToggle ?? vi.fn()}
            onAction={props.onAction ?? vi.fn()}
            onContextMenu={props.onContextMenu ?? vi.fn()}
            onRepoClick={props.onRepoClick ?? vi.fn()}
            {...props}
        />
    )
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('RepoCard — accessible card structure (nested-interactive fix)', () => {
    it('container is not an interactive/focusable widget (no role, no tabindex)', () => {
        renderCard()
        const card = screen.getByTestId('repo-card')
        expect(card).not.toHaveAttribute('role')
        expect(card).not.toHaveAttribute('tabindex')
    })

    it('exposes a real title button (open) and a real select button as siblings', () => {
        renderCard()
        const open = screen.getByTestId('repo-card-open')
        const select = screen.getByTestId('repo-card-select')
        expect(open.tagName).toBe('BUTTON')
        expect(select.tagName).toBe('BUTTON')
        // Neither control is nested inside the other — they are independent
        // controls layered over the card, which is what clears nested-interactive.
        expect(open.contains(select)).toBe(false)
        expect(select.contains(open)).toBe(false)
    })

    it('the select control reflects selection via aria-pressed', () => {
        const { rerender } = renderCard({ isSelected: false })
        expect(screen.getByTestId('repo-card-select')).toHaveAttribute('aria-pressed', 'false')
        rerender(
            <RepoCard
                repo={repo}
                viewMode="grid"
                isSelected
                isContextTarget={false}
                onToggle={vi.fn()}
                onAction={vi.fn()}
                onContextMenu={vi.fn()}
                onRepoClick={vi.fn()}
            />
        )
        expect(screen.getByTestId('repo-card-select')).toHaveAttribute('aria-pressed', 'true')
    })

    it('clicking the card body (select control) toggles selection, not open', async () => {
        const user = userEvent.setup()
        const onToggle = vi.fn()
        const onRepoClick = vi.fn()
        renderCard({ onToggle, onRepoClick })

        await user.click(screen.getByTestId('repo-card-select'))
        expect(onToggle).toHaveBeenCalledTimes(1)
        expect(onRepoClick).not.toHaveBeenCalled()
    })

    it('clicking the title button opens the repo, not select', async () => {
        const user = userEvent.setup()
        const onToggle = vi.fn()
        const onRepoClick = vi.fn()
        renderCard({ onToggle, onRepoClick })

        await user.click(screen.getByTestId('repo-card-open'))
        expect(onRepoClick).toHaveBeenCalledWith(repo)
        expect(onToggle).not.toHaveBeenCalled()
    })
})

describe('RepoCard — the description clamp pays for what it shows', () => {
    /*
     * The base clamp was `line-clamp-1` while `min-h-[2.5em]` reserved two
     * lines. Measured in the real app at 375px: a 35px box painting a single
     * 20px line, with the second line cut. The grid is
     * `minmax(min(--card-min-width, 100%), 1fr)`, so a phone gets ONE
     * full-width card — the widest the card ever is relative to its viewport,
     * and so the worst place to clamp hardest.
     *
     * Only the base clamp is asserted. Raising the clamp at wider breakpoints
     * (`xl:line-clamp-3`) is the normal mobile-first direction and needs no
     * guard; it was the base falling BELOW what the reserved height pays for
     * that produced the defect.
     */
    it('shows at least as many lines as the reserved height pays for', () => {
        renderCard()
        const cls = screen.getByText(repo.description).className

        const reserved = cls.match(/min-h-\[([\d.]+)em\]/)
        expect(reserved, 'the reserved height went away — re-derive this bound').not.toBeNull()
        const linesPaidFor = Math.floor(Number(reserved[1]) / 1.25)

        const base = cls.match(/(?:^|\s)line-clamp-(\d+)/)
        expect(base, 'the description lost its base line-clamp').not.toBeNull()
        expect(Number(base[1]), `line-clamp-${base[1]} in a box that pays for ${linesPaidFor} lines`)
            .toBeGreaterThanOrEqual(linesPaidFor)
    })
})
