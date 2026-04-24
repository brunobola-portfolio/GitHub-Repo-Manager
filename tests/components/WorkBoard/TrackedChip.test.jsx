import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [],
    pin: vi.fn().mockResolvedValue({ operation_id: 'op-p', new_state: { is_pinned: 1 } }),
    unpin: vi.fn().mockResolvedValue({ operation_id: 'op-up', new_state: { is_pinned: 0 } }),
    mute: vi.fn().mockResolvedValue({ operation_id: 'op-m', new_state: { is_muted: 1 } }),
    unmute: vi.fn().mockResolvedValue({ operation_id: 'op-um', new_state: { is_muted: 0 } }),
    track: vi.fn().mockResolvedValue({ operation_id: 'op-t', new_state: { is_pinned: 1 } }),
    untrack: vi.fn().mockResolvedValue({ operation_id: 'op-un', new_state: null }),
    undo: vi.fn(),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

const { TrackedChip } = await import('../../../src/components/WorkBoard/TrackedChip')

beforeEach(() => {
    for (const k of ['pin', 'unpin', 'mute', 'unmute', 'track', 'untrack', 'undo']) mockHook[k].mockClear()
    mockToast.success.mockClear()
    mockToast.error.mockClear()
    mockHook.repos = []
})

describe('TrackedChip', () => {
    it('renders "+ Track" when repo is not tracked', () => {
        render(<TrackedChip repoFullName="acme/x" />)
        expect(screen.getByRole('button', { name: /track acme\/x/i })).toBeInTheDocument()
        expect(screen.getByText(/\+ ?track/i)).toBeInTheDocument()
    })

    it('clicking "+ Track" calls hook.track', async () => {
        render(<TrackedChip repoFullName="acme/x" />)
        fireEvent.click(screen.getByRole('button', { name: /track acme\/x/i }))
        await waitFor(() => expect(mockHook.track).toHaveBeenCalledWith('acme/x'))
    })

    it('renders "Tracked" when repo is tracked (not muted)', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 0 }]
        render(<TrackedChip repoFullName="acme/x" />)
        expect(screen.getByRole('button', { name: /tracked acme\/x/i })).toBeInTheDocument()
    })

    it('renders "Muted" when repo is muted', () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 0, is_muted: 1 }]
        render(<TrackedChip repoFullName="acme/x" />)
        expect(screen.getByRole('button', { name: /muted acme\/x/i })).toBeInTheDocument()
    })

    it('clicking "Tracked" chip opens popover with Unpin/Mute/Stop options', async () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 1, is_muted: 0 }]
        render(<TrackedChip repoFullName="acme/x" />)
        fireEvent.click(screen.getByRole('button', { name: /tracked acme\/x/i }))
        expect(await screen.findByText(/unpin/i)).toBeInTheDocument()
        expect(screen.getByText(/mute/i)).toBeInTheDocument()
        expect(screen.getByText(/stop tracking/i)).toBeInTheDocument()
    })

    it('shows undo toast on successful track', async () => {
        render(<TrackedChip repoFullName="acme/x" />)
        fireEvent.click(screen.getByRole('button', { name: /track acme\/x/i }))
        await waitFor(() => expect(mockToast.success).toHaveBeenCalled())
    })
})
