import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
})
