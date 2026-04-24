import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const mockHook = {
    repos: [],
    prefs: { discovery_window_days: 60, max_auto_repos: 50, auto_mute_bots: 0, last_discovery_at: null },
    countsBySignal: {},
    isLoading: false,
    isRefreshing: false,
    pin: vi.fn(),
    unpin: vi.fn(),
    mute: vi.fn(),
    unmute: vi.fn(),
    track: vi.fn(),
    untrack: vi.fn(),
    bulkUpdate: vi.fn(),
    updatePrefs: vi.fn().mockResolvedValue({}),
    discover: vi.fn().mockResolvedValue({ discovered: 0, added: 0, removed: 0 }),
    refresh: vi.fn(),
    undo: vi.fn(),
}
vi.mock('../../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
vi.mock('../../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

// useLicense exposes { license: { tier } }. The component reads license?.tier ?? 'free'.
vi.mock('../../../../src/hooks/useLicense', () => ({
    useLicense: () => ({ license: { tier: 'pro' } }),
}))

// The TrackedReposList uses @tanstack/react-virtual which requires a real
// scroll container. Mock it so virtual items are rendered in jsdom.
vi.mock('@tanstack/react-virtual', async () => {
    const actual = await vi.importActual('@tanstack/react-virtual')
    return {
        ...actual,
        useVirtualizer: (options) => ({
            getTotalSize: () => options.count * 56,
            getVirtualItems: () =>
                Array.from({ length: options.count }, (_, i) => ({
                    index: i,
                    size: 56,
                    start: i * 56,
                    key: i,
                })),
        }),
    }
})

const { WorkBoardSettingsSection } = await import('../../../../src/components/Settings/WorkBoard/WorkBoardSettingsSection')

beforeEach(() => {
    for (const k of Object.keys(mockHook)) {
        if (typeof mockHook[k]?.mockClear === 'function') mockHook[k].mockClear()
    }
    for (const k of Object.keys(mockToast)) mockToast[k].mockClear()
    mockHook.repos = []
    mockHook.isLoading = false
})

describe('WorkBoardSettingsSection', () => {
    it('renders all four cards', () => {
        render(<WorkBoardSettingsSection />)
        // Multiple elements may contain "discovery" — use getAllByText and assert at least one
        expect(screen.getAllByText(/discovery/i).length).toBeGreaterThan(0)
        expect(screen.getByText(/live updates/i)).toBeInTheDocument()
        expect(screen.getByText(/danger zone/i)).toBeInTheDocument()
    })

    it('refresh button triggers discover() and shows toast on success', async () => {
        render(<WorkBoardSettingsSection />)
        fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
        await waitFor(() => expect(mockHook.discover).toHaveBeenCalled())
    })

    it('pin from row menu calls hook.pin', async () => {
        mockHook.repos = [{
            repo_full_name: 'acme/x', source_signal: 'owned',
            is_pinned: 0, is_muted: 0, last_activity_at: '2026-04-20T00:00Z',
        }]
        mockHook.pin.mockResolvedValue({ operation_id: 'op-1', new_state: { is_pinned: 1 } })
        render(<WorkBoardSettingsSection />)
        fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
        fireEvent.click(await screen.findByText(/^Pin$/i))
        await waitFor(() => expect(mockHook.pin).toHaveBeenCalledWith('acme/x'))
    })
})
