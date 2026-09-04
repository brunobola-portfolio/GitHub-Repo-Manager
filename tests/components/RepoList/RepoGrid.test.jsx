import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, within, fireEvent, cleanup } from '@testing-library/react'
import { RepoGrid } from '@/components/RepoList/RepoGrid'

// Isolate RepoCard from its data hooks, same as RepoCard.test.jsx.
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

// Render counter for the memo test below. TrackedDot renders once per RepoCard
// and returns null under the empty useTrackedRepos mock above, so standing in
// for it is a non-invasive way to count real RepoCard render passes.
const cardRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/components/WorkBoard/TrackedDot', () => ({
    TrackedDot: () => { cardRenders.count++; return null },
}))

function makeRepo(id) {
    return {
        id,
        name: `repo-${id}`,
        full_name: `octo/repo-${id}`,
        owner: { login: 'octo' },
        private: false,
        archived: false,
        stargazers_count: 0,
        forks_count: 0,
        open_issues_count: 0,
    }
}

function baseProps(repos) {
    return {
        repos,
        viewMode: 'grid',
        isSearchingAI: false,
        selectedIds: new Set(),
        contextTargetId: null,
        onToggle: vi.fn(),
        onAction: vi.fn(),
        onContextMenu: vi.fn(),
        onRepoClick: vi.fn(),
    }
}

describe('RepoGrid — exit animation for filtered-out cards', () => {
    it('keeps a removed card mounted during its exit transition instead of vanishing instantly (AnimatePresence + RepoCard exit wired up)', async () => {
        const repos = [makeRepo(1), makeRepo(2)]
        const { rerender } = render(<RepoGrid {...baseProps(repos)} />)
        expect(screen.getAllByTestId('repo-card')).toHaveLength(2)

        rerender(<RepoGrid {...baseProps([makeRepo(2)])} />)

        // Without AnimatePresence wrapping the list (or without RepoCard's `exit`
        // prop), removing repo 1 from the array would unmount it synchronously
        // on this same render pass, leaving only 1 card immediately.
        expect(screen.getAllByTestId('repo-card')).toHaveLength(2)

        await waitFor(() => {
            expect(screen.getAllByTestId('repo-card')).toHaveLength(1)
        })
    })

    it('drops the AnimatePresence wrapper at/above the 50-card threshold — removals unmount instantly (mirrors the wizard virtualization threshold)', () => {
        const repos = Array.from({ length: 51 }, (_, i) => makeRepo(i + 1))
        const { rerender } = render(<RepoGrid {...baseProps(repos)} />)
        expect(screen.getAllByTestId('repo-card')).toHaveLength(51)

        rerender(<RepoGrid {...baseProps(repos.slice(1))} />)

        // Static branch: no exit animation holds the removed card in the DOM —
        // the count drops synchronously on the same render pass.
        expect(screen.getAllByTestId('repo-card')).toHaveLength(50)
    })
})

describe('RepoGrid — memoized cards keep their callbacks fresh', () => {
    beforeEach(() => { cardRenders.count = 0 })

    it('routes a re-created callback to a card whose repo data did not change', () => {
        // RepoList rebuilds onRepoClick/onAction/onContextMenu on every render.
        // RepoCard's comparator used to EXCLUDE the callbacks, so a card whose
        // repo object was unchanged kept invoking the first closure forever.
        const repos = [makeRepo(1)]
        const first = vi.fn()
        const second = vi.fn()

        const { rerender } = render(<RepoGrid {...baseProps(repos)} onRepoClick={first} />)
        rerender(<RepoGrid {...baseProps(repos)} onRepoClick={second} />)

        screen.getByTestId('repo-card-open').click()
        expect(second).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledWith(repos[0])
        expect(first).not.toHaveBeenCalled()
    })

    it('still skips re-rendering cards when only the callback identities changed', () => {
        const repos = Array.from({ length: 5 }, (_, i) => makeRepo(i + 1))
        const { rerender } = render(<RepoGrid {...baseProps(repos)} />)
        expect(cardRenders.count).toBe(5)

        // baseProps() hands over brand-new callback identities each call — the
        // exact shape RepoList produces. The memo must still bite, otherwise
        // including the callbacks in the comparator would have cost every card
        // a re-render on every parent render.
        rerender(<RepoGrid {...baseProps(repos)} />)
        expect(cardRenders.count).toBe(5)
    })
})

describe('RepoGrid — list-mode windowing (useVirtualWindow)', () => {
    beforeEach(() => {
        // rAF-throttled recalculation — run synchronously so assertions right
        // after a scroll/resize dispatch see the updated window.
        vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 0 })
        vi.stubGlobal('cancelAnimationFrame', () => {})
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('does not mount the full DOM for a large list — off-window rows are absent', () => {
        const repos = Array.from({ length: 200 }, (_, i) => makeRepo(i + 1))
        render(<RepoGrid {...baseProps(repos)} viewMode="list" />)

        const rendered = screen.getAllByTestId('repo-card')
        // happy-dom's default 0 scroll position + ~768px viewport / 100px rows
        // mounts roughly the first screenful plus overscan — nowhere near 200.
        expect(rendered.length).toBeGreaterThan(0)
        expect(rendered.length).toBeLessThan(50)

        // The first repo is inside the initial window; a repo far down the
        // list is not — proving off-window rows are genuinely absent from the
        // DOM, not just visually hidden.
        expect(screen.queryByText('repo-1')).toBeInTheDocument()
        expect(screen.queryByText('repo-199')).not.toBeInTheDocument()
    })

    it('stays under the windowing threshold as a plain static list — every row mounts', () => {
        const repos = Array.from({ length: 49 }, (_, i) => makeRepo(i + 1))
        render(<RepoGrid {...baseProps(repos)} viewMode="list" />)
        expect(screen.getAllByTestId('repo-card')).toHaveLength(49)
    })

    it('mounts a previously off-window row once it scrolls into range, and it stays interactive', () => {
        const repos = Array.from({ length: 200 }, (_, i) => makeRepo(i + 1))
        const onToggle = vi.fn()
        render(<RepoGrid {...baseProps(repos)} viewMode="list" onToggle={onToggle} />)

        expect(screen.queryByText('repo-150')).not.toBeInTheDocument()

        const container = screen.getByTestId('repo-grid-virtual-window')
        // Simulate the list having scrolled ~15000px past the viewport top —
        // row 150 (index 149, 100px/row) now falls inside the window.
        vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
            top: -15000, bottom: 5000, left: 0, right: 0, width: 0, height: 20000,
        })
        act(() => { window.dispatchEvent(new Event('scroll')) })

        expect(screen.queryByText('repo-1')).not.toBeInTheDocument()
        const row150Title = screen.getByText('repo-150')
        expect(row150Title).toBeInTheDocument()

        // The scrolled-in row's selection control is a real, working control —
        // not an inert clone left over from the window shift.
        const row150Card = row150Title.closest('[data-testid="repo-card"]')
        within(row150Card).getByTestId('repo-card-select').click()
        expect(onToggle).toHaveBeenCalledWith(150)
    })

    it('grid mode is never windowed, regardless of row count (responsive column count makes fixed-row windowing unsafe)', () => {
        const repos = Array.from({ length: 200 }, (_, i) => makeRepo(i + 1))
        render(<RepoGrid {...baseProps(repos)} viewMode="grid" />)
        expect(screen.getAllByTestId('repo-card')).toHaveLength(200)
        expect(screen.queryByTestId('repo-grid-virtual-window')).not.toBeInTheDocument()
    })
})

describe('RepoGrid — j/k/Enter row navigation (G4: parity with the Work Board)', () => {
    afterEach(() => cleanup())

    it('j/k move real DOM focus across the cards’ select controls (so ds-focus-ring — a :focus-visible rule — lights up without a bespoke ring class)', () => {
        const repos = [makeRepo(1), makeRepo(2), makeRepo(3)]
        render(<RepoGrid {...baseProps(repos)} />)
        const cards = screen.getAllByTestId('repo-card-select')

        fireEvent.keyDown(window, { key: 'j' })
        expect(document.activeElement).toBe(cards[0])

        fireEvent.keyDown(window, { key: 'j' })
        expect(document.activeElement).toBe(cards[1])

        fireEvent.keyDown(window, { key: 'k' })
        expect(document.activeElement).toBe(cards[0])
    })

    it('Enter opens the focused repo and does not also toggle its selection', () => {
        const repos = [makeRepo(1), makeRepo(2)]
        const onRepoClick = vi.fn()
        const onToggle = vi.fn()
        render(<RepoGrid {...baseProps(repos)} onRepoClick={onRepoClick} onToggle={onToggle} />)

        fireEvent.keyDown(window, { key: 'j' })
        fireEvent.keyDown(window, { key: 'Enter' })

        expect(onRepoClick).toHaveBeenCalledWith(repos[0])
        expect(onToggle).not.toHaveBeenCalled()
    })

    it('does not move focus while typing in an unrelated input (useFocusedRow input guard)', () => {
        const repos = [makeRepo(1), makeRepo(2)]
        render(<RepoGrid {...baseProps(repos)} />)
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()

        fireEvent.keyDown(input, { key: 'j' })
        expect(document.activeElement).toBe(input)

        input.remove()
    })
})
