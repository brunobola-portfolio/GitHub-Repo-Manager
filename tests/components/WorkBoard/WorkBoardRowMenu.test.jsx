import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [],
    pin: vi.fn().mockResolvedValue({ operation_id: 'op-p', new_state: { is_pinned: 1 } }),
    unpin: vi.fn().mockResolvedValue({ operation_id: 'op-up', new_state: { is_pinned: 0 } }),
    mute: vi.fn().mockResolvedValue({ operation_id: 'op-m', new_state: { is_muted: 1 } }),
    unmute: vi.fn().mockResolvedValue({ operation_id: 'op-um', new_state: { is_muted: 0 } }),
    untrack: vi.fn().mockResolvedValue({ operation_id: 'op-un', new_state: null }),
    undo: vi.fn(),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

const { WorkBoardRowMenu } = await import('../../../src/components/WorkBoard/WorkBoardRowMenu')

beforeEach(() => {
    for (const k of Object.keys(mockHook)) {
        if (typeof mockHook[k]?.mockClear === 'function') mockHook[k].mockClear()
    }
    for (const k of Object.keys(mockToast)) mockToast[k].mockClear()
    mockHook.repos = []
})

describe('WorkBoardRowMenu', () => {
    it('renders only a trigger button initially', () => {
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument()
    })

    it('opens menu on click with Pin + Mute + Stop tracking options', async () => {
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        expect(await screen.findByText(/pin acme\/x/i)).toBeInTheDocument()
        expect(screen.getByText(/mute acme\/x/i)).toBeInTheDocument()
        expect(screen.getByText(/stop tracking acme\/x/i)).toBeInTheDocument()
    })

    it('shows Unpin when repo is already pinned in the tracked store', async () => {
        mockHook.repos = [{ repo_full_name: 'acme/x', is_pinned: 1, is_muted: 0 }]
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        expect(await screen.findByText(/unpin acme\/x/i)).toBeInTheDocument()
    })

    it('Pin click calls hook.pin + fires undo-toast with action callback', async () => {
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        fireEvent.click(await screen.findByText(/pin acme\/x/i))
        await waitFor(() => expect(mockHook.pin).toHaveBeenCalledWith('acme/x'))
        expect(mockToast.success).toHaveBeenCalled()
    })

    it('Copy link writes the GitHub URL to clipboard', async () => {
        const writeText = vi.fn()
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        })
        render(<WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        fireEvent.click(await screen.findByText(/copy link/i))
        expect(writeText).toHaveBeenCalledWith('https://github.com/acme/x/pull/1')
    })

    it('trigger click does not bubble to parent (stopPropagation)', async () => {
        const parentClick = vi.fn()
        render(
            <button type="button" onClick={parentClick}>
                <WorkBoardRowMenu repoFullName="acme/x" itemUrl="https://github.com/acme/x/pull/1" />
            </button>
        )
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        expect(parentClick).not.toHaveBeenCalled()
    })
})
