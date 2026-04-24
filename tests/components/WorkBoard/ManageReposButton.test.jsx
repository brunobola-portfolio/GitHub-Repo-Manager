import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [
        { repo_full_name: 'acme/a', is_pinned: 0, is_muted: 0, last_activity_at: '2026-04-22T10:00Z' },
        { repo_full_name: 'acme/b', is_pinned: 1, is_muted: 0, last_activity_at: '2026-04-21T10:00Z' },
        { repo_full_name: 'tesla/c', is_pinned: 0, is_muted: 1, last_activity_at: '2026-04-20T10:00Z' },
    ],
    pin: vi.fn().mockResolvedValue({ operation_id: 'op-p', new_state: { is_pinned: 1 } }),
    unpin: vi.fn().mockResolvedValue({ operation_id: 'op-up', new_state: { is_pinned: 0 } }),
    mute: vi.fn().mockResolvedValue({ operation_id: 'op-m', new_state: { is_muted: 1 } }),
    unmute: vi.fn().mockResolvedValue({ operation_id: 'op-um', new_state: { is_muted: 0 } }),
    undo: vi.fn(),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

const { ManageReposButton } = await import('../../../src/components/WorkBoard/ManageReposButton')

beforeEach(() => {
    for (const k of ['pin', 'unpin', 'mute', 'unmute', 'undo']) mockHook[k].mockClear()
    mockToast.success.mockClear()
    mockToast.error.mockClear()
})

describe('ManageReposButton', () => {
    it('opens popover and shows tracked repos sorted by last_activity_at DESC', async () => {
        render(<ManageReposButton onOpenSettings={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /manage repos/i }))
        await waitFor(() => expect(screen.getByText('acme/a')).toBeInTheDocument())
        const items = screen.getAllByTestId('manage-repo-row').map(el => el.textContent)
        expect(items[0]).toContain('acme/a')
        expect(items[1]).toContain('acme/b')
        expect(items[2]).toContain('tesla/c')
    })

    it('search filters the visible list (case-insensitive)', async () => {
        render(<ManageReposButton onOpenSettings={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /manage repos/i }))
        await screen.findByText('acme/a')
        fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'TESLA' } })
        await waitFor(() => {
            expect(screen.queryByText('acme/a')).not.toBeInTheDocument()
            expect(screen.getByText('tesla/c')).toBeInTheDocument()
        })
    })

    it('clicking the Pin toggle calls hook.pin for unpinned repo', async () => {
        render(<ManageReposButton onOpenSettings={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /manage repos/i }))
        await screen.findByText('acme/a')
        const pinButtons = screen.getAllByRole('button', { name: /^pin acme\/a$/i })
        fireEvent.click(pinButtons[0])
        await waitFor(() => expect(mockHook.pin).toHaveBeenCalledWith('acme/a'))
    })

    it('"See all in Settings" calls onOpenSettings', async () => {
        const onOpenSettings = vi.fn()
        render(<ManageReposButton onOpenSettings={onOpenSettings} />)
        fireEvent.click(screen.getByRole('button', { name: /manage repos/i }))
        fireEvent.click(await screen.findByRole('button', { name: /see all in settings/i }))
        expect(onOpenSettings).toHaveBeenCalled()
    })
})
