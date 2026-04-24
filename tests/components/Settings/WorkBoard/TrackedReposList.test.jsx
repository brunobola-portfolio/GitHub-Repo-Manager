import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@tanstack/react-virtual', async () => {
    const actual = await vi.importActual('@tanstack/react-virtual')
    return {
        ...actual,
        useVirtualizer: (options) => ({
            getTotalSize: () => options.count * 56,
            getVirtualItems: () => Array.from({ length: options.count }, (_, i) => ({ index: i, size: 56, start: i * 56, key: i })),
        }),
    }
})

import { TrackedReposList } from '../../../../src/components/Settings/WorkBoard/TrackedReposList'

function makeRepos(n) {
    return Array.from({ length: n }, (_, i) => ({
        repo_full_name: `org/repo-${i}`,
        source_signal: 'owned',
        is_pinned: 0,
        is_muted: 0,
        last_activity_at: '2026-04-20T10:00:00Z',
    }))
}

describe('TrackedReposList', () => {
    it('renders empty state when no repos', () => {
        render(
            <TrackedReposList
                repos={[]}
                countsBySignal={{}}
                filters={{}}
                isLoading={false}
                onFilterChange={() => {}}
                onRowAction={() => {}}
                onBulkAction={() => {}}
            />
        )
        expect(screen.getByText(/no tracked repositories yet/i)).toBeInTheDocument()
    })

    it('renders empty-search state when filters yield 0', () => {
        render(
            <TrackedReposList
                repos={[]}
                countsBySignal={{}}
                filters={{ search: 'nope' }}
                isLoading={false}
                onFilterChange={() => {}}
                onRowAction={() => {}}
                onBulkAction={() => {}}
            />
        )
        expect(screen.getByText(/no results for "nope"/i)).toBeInTheDocument()
    })

    it('fires onRowAction when a row menu action is triggered', async () => {
        const onRowAction = vi.fn()
        render(
            <TrackedReposList
                repos={makeRepos(3)}
                countsBySignal={{ owned: 3 }}
                filters={{}}
                isLoading={false}
                onFilterChange={() => {}}
                onRowAction={onRowAction}
                onBulkAction={() => {}}
            />
        )
        const menuButtons = screen.getAllByRole('button', { name: /more actions/i })
        fireEvent.click(menuButtons[0])
        fireEvent.click(await screen.findByText(/^Pin$/i))
        expect(onRowAction).toHaveBeenCalledWith('org/repo-0', 'pin')
    })

    it('shows BulkActionsBar after selecting rows', () => {
        render(
            <TrackedReposList
                repos={makeRepos(3)}
                countsBySignal={{ owned: 3 }}
                filters={{}}
                isLoading={false}
                onFilterChange={() => {}}
                onRowAction={() => {}}
                onBulkAction={() => {}}
            />
        )
        const checkboxes = screen.getAllByRole('checkbox').filter(c => c.getAttribute('aria-label')?.startsWith('Select'))
        fireEvent.click(checkboxes[0])
        fireEvent.click(checkboxes[1])
        expect(screen.getByText(/2 selected/i)).toBeInTheDocument()
    })
})
