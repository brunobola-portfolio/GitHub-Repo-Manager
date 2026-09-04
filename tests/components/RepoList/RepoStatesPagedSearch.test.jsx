/*
 * "No matches" used to blame the filters when the match sat on a page the
 * client-side search never saw. The empty state now names its scope and
 * offers to load every page.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from '@/components/RepoList/RepoStates'

describe('RepoList EmptyState — paged search', () => {
    it('offers to search every page when the text search only saw one', () => {
        const onSearchAllPages = vi.fn()
        render(
            <EmptyState hasRepos onClearFilters={vi.fn()} pagedSearch onSearchAllPages={onSearchAllPages} />
        )
        expect(screen.getByText(/no matches on this page/i)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /search all pages/i }))
        expect(onSearchAllPages).toHaveBeenCalledTimes(1)
    })

    it('keeps the plain "No matches" state once every page is loaded', () => {
        render(<EmptyState hasRepos onClearFilters={vi.fn()} pagedSearch={false} onSearchAllPages={vi.fn()} />)
        expect(screen.getByText(/^no matches$/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /search all pages/i })).not.toBeInTheDocument()
    })
})
