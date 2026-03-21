import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConflictPanel } from '../../src/components/ConflictPanel'

const mockConflict = {
    exists: true,
    source: {
        full_name: 'user/repo',
        updated_at: '2026-01-16T00:00:00Z',
        pushed_at: '2026-01-16T00:00:00Z',
        size: 2400,
        language: 'JavaScript',
        stargazers_count: 5,
        forks_count: 2
    },
    target: {
        full_name: 'org/repo',
        updated_at: '2025-12-01T00:00:00Z',
        pushed_at: '2025-12-01T00:00:00Z',
        size: 2100,
        language: 'JavaScript',
        stargazers_count: 0,
        forks_count: 0
    }
}

describe('ConflictPanel', () => {
    it('renders source and target metadata', () => {
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={() => {}} />)
        expect(screen.getByText('Source')).toBeInTheDocument()
        expect(screen.getByText('Target')).toBeInTheDocument()
    })

    it('shows source is newer when source updated_at > target', () => {
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={() => {}} />)
        expect(screen.getByText(/newer/i)).toBeInTheDocument()
    })

    it('calls onResolve with replace action', () => {
        const onResolve = vi.fn()
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={onResolve} />)
        fireEvent.click(screen.getByRole('button', { name: /replace/i }))
        // Replace requires confirmation click
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
        expect(onResolve).toHaveBeenCalledWith({ action: 'replace' })
    })

    it('calls onResolve with skip action', () => {
        const onResolve = vi.fn()
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={onResolve} />)
        fireEvent.click(screen.getByRole('button', { name: /skip/i }))
        expect(onResolve).toHaveBeenCalledWith({ action: 'skip' })
    })

    it('calls onResolve with rename action and new name', () => {
        const onResolve = vi.fn()
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={onResolve} />)
        fireEvent.click(screen.getByRole('button', { name: /rename/i }))
        const input = screen.getByDisplayValue('repo-2')
        fireEvent.change(input, { target: { value: 'repo-new' } })
        fireEvent.click(screen.getByRole('button', { name: /confirm rename/i }))
        expect(onResolve).toHaveBeenCalledWith({ action: 'rename', newName: 'repo-new' })
    })

    it('shows resolved state and allows changing resolution', () => {
        const onResolve = vi.fn()
        render(<ConflictPanel conflict={mockConflict} repoName="repo" resolution={{ action: 'skip' }} onResolve={onResolve} />)
        expect(screen.getByText(/will skip/i)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /change/i }))
        expect(onResolve).toHaveBeenCalledWith(null)
    })
})
