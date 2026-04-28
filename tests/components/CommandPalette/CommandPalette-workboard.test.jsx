import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [
        { repo_full_name: 'acme/x', is_pinned: 0, is_muted: 0 },
        { repo_full_name: 'acme/y', is_pinned: 1, is_muted: 0 },
    ],
    pin: vi.fn().mockResolvedValue({ operation_id: 'op-p', new_state: { is_pinned: 1 } }),
    unpin: vi.fn().mockResolvedValue({ operation_id: 'op-up', new_state: { is_pinned: 0 } }),
    mute: vi.fn().mockResolvedValue({ operation_id: 'op-m', new_state: { is_muted: 1 } }),
    unmute: vi.fn().mockResolvedValue({}),
    untrack: vi.fn().mockResolvedValue({ operation_id: 'op-un', new_state: null }),
    discover: vi.fn().mockResolvedValue({ discovered: 3, added: 3, removed: 0 }),
    refresh: vi.fn(),
    undo: vi.fn(),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

vi.mock('../../../src/api/search', () => ({
    searchApi: { github: vi.fn().mockResolvedValue({ prs: [], issues: [], repos: [] }) },
}))

// Palette's "smart search" calls translateSearch, which goes through aiFetch
// and tries to GET /api/auth/csrf-token. With no global.fetch mock the
// request hits localhost:3000 → ECONNREFUSED. These tests don't exercise
// the AI search path so we stub it.
vi.mock('../../../src/api/translateSearch', () => ({
    translateSearch: vi.fn().mockResolvedValue(null),
}))

const { CommandPalette } = await import('../../../src/components/CommandPalette')

beforeEach(() => {
    for (const k of ['pin', 'unpin', 'mute', 'unmute', 'untrack', 'discover', 'undo']) mockHook[k].mockClear()
    mockToast.success.mockClear()
    mockToast.error.mockClear()
})

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    repos: [],
    activeView: 'dashboard',
    onViewChange: vi.fn(),
    onOpenModal: vi.fn(),
    onSelectRepo: vi.fn(),
    isAdmin: false,
}

describe('CommandPalette — Work Board commands', () => {
    it('renders Tracked Repositories group with Pin/Mute/Untrack per repo', () => {
        render(<CommandPalette {...baseProps} />)
        expect(screen.getByText(/Pin acme\/x/i)).toBeInTheDocument()
        expect(screen.getByText(/Mute acme\/x/i)).toBeInTheDocument()
        expect(screen.getByText(/Stop tracking acme\/x/i)).toBeInTheDocument()
        expect(screen.getByText(/Unpin acme\/y/i)).toBeInTheDocument()
    })

    it('selecting Pin acme/x calls hook.pin', async () => {
        render(<CommandPalette {...baseProps} />)
        fireEvent.click(screen.getByText(/Pin acme\/x/i))
        await waitFor(() => expect(mockHook.pin).toHaveBeenCalledWith('acme/x'))
    })

    it('selecting Refresh discovery calls hook.discover', async () => {
        render(<CommandPalette {...baseProps} />)
        fireEvent.click(screen.getByText(/Refresh discovery/i))
        await waitFor(() => expect(mockHook.discover).toHaveBeenCalled())
    })

    it('selecting Refresh Work Board dispatches workboard:refresh-all event', () => {
        const listener = vi.fn()
        window.addEventListener('workboard:refresh-all', listener)
        render(<CommandPalette {...baseProps} />)
        fireEvent.click(screen.getByText(/Refresh Work Board/i))
        expect(listener).toHaveBeenCalled()
        window.removeEventListener('workboard:refresh-all', listener)
    })

    it('selecting a mutation surfaces an undo toast when operation_id is present', async () => {
        render(<CommandPalette {...baseProps} />)
        fireEvent.click(screen.getByText(/Pin acme\/x/i))
        await waitFor(() => expect(mockToast.success).toHaveBeenCalled())
        const [, opts] = mockToast.success.mock.calls[0]
        expect(opts?.action).toBe('Undo')
    })
})
