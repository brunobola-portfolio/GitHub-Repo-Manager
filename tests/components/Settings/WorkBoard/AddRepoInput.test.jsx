import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSearch = vi.fn()
vi.mock('../../../../src/api/workBoardTracking', () => ({
    searchRepos: mockSearch,
}))

const { AddRepoInput } = await import('../../../../src/components/Settings/WorkBoard/AddRepoInput')

describe('AddRepoInput', () => {
    it('calls searchRepos on input change (debounced)', async () => {
        mockSearch.mockResolvedValue({ tracked: [], untracked: [] })
        render(<AddRepoInput onAdd={() => {}} />)

        fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'acme' } })
        await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('acme'), { timeout: 1000 })
    })

    it('shows "Add as new" option when query looks like owner/repo', async () => {
        mockSearch.mockResolvedValue({ tracked: [], untracked: [] })
        render(<AddRepoInput onAdd={() => {}} />)
        fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'acme/new-thing' } })
        expect(await screen.findByText(/add acme\/new-thing/i)).toBeInTheDocument()
    })

    it('fires onAdd when "Add as new" clicked', async () => {
        mockSearch.mockResolvedValue({ tracked: [], untracked: [] })
        const onAdd = vi.fn()
        render(<AddRepoInput onAdd={onAdd} />)
        fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'acme/new-thing' } })
        fireEvent.click(await screen.findByText(/add acme\/new-thing/i))
        expect(onAdd).toHaveBeenCalledWith('acme/new-thing')
    })

    it('does not show "Add as new" for invalid format', async () => {
        mockSearch.mockResolvedValue({ tracked: [], untracked: [] })
        render(<AddRepoInput onAdd={() => {}} />)
        fireEvent.change(screen.getByPlaceholderText(/owner\/repo/i), { target: { value: 'no-slash' } })
        await new Promise(r => setTimeout(r, 300))
        expect(screen.queryByText(/add no-slash/i)).not.toBeInTheDocument()
    })
})
