import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RepoRow } from '../../../../src/components/Settings/WorkBoard/RepoRow'

function baseRepo(overrides = {}) {
    return {
        repo_full_name: 'acme/backend',
        source_signal: 'review_requested',
        is_pinned: 0,
        is_muted: 0,
        last_activity_at: '2026-04-20T10:00:00Z',
        ...overrides,
    }
}

describe('RepoRow', () => {
    it('renders repo name and signal badge', () => {
        render(<RepoRow repo={baseRepo()} onAction={() => {}} />)
        expect(screen.getByText('acme/backend')).toBeInTheDocument()
        expect(screen.getByText(/review.requested/i)).toBeInTheDocument()
    })

    it('shows pinned indicator when is_pinned=1', () => {
        render(<RepoRow repo={baseRepo({ is_pinned: 1 })} onAction={() => {}} />)
        expect(screen.getByLabelText(/pinned/i)).toBeInTheDocument()
    })

    it('shows muted indicator when is_muted=1', () => {
        render(<RepoRow repo={baseRepo({ is_muted: 1 })} onAction={() => {}} />)
        expect(screen.getByLabelText(/muted/i)).toBeInTheDocument()
    })

    it('fires onAction(repo_full_name, "pin") when Pin clicked in menu', () => {
        const onAction = vi.fn()
        render(<RepoRow repo={baseRepo()} onAction={onAction} />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        fireEvent.click(screen.getByText(/^Pin$/i))
        expect(onAction).toHaveBeenCalledWith('acme/backend', 'pin')
    })

    it('shows "Unpin" when already pinned', () => {
        const onAction = vi.fn()
        render(<RepoRow repo={baseRepo({ is_pinned: 1 })} onAction={onAction} />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        expect(screen.getByText(/^Unpin$/i)).toBeInTheDocument()
        expect(screen.queryByText(/^Pin$/i)).not.toBeInTheDocument()
    })

    it('fires onSelectionChange when checkbox toggled', () => {
        const onSelectionChange = vi.fn()
        render(
            <RepoRow
                repo={baseRepo()}
                onAction={() => {}}
                selected={false}
                onSelectionChange={onSelectionChange}
            />
        )
        fireEvent.click(screen.getByRole('checkbox'))
        expect(onSelectionChange).toHaveBeenCalledWith('acme/backend', true)
    })
})
