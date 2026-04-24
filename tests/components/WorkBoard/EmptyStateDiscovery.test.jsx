import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [],
    prefs: { last_discovery_at: null },
    isRefreshing: false,
    discover: vi.fn().mockResolvedValue({ discovered: 5, added: 5, removed: 0 }),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

const { EmptyStateDiscovery } = await import('../../../src/components/WorkBoard/EmptyStateDiscovery')

beforeEach(() => {
    mockHook.repos = []
    mockHook.prefs = { last_discovery_at: null }
    mockHook.isRefreshing = false
    mockHook.discover.mockClear()
    mockToast.success.mockClear()
    mockToast.error.mockClear()
})

describe('EmptyStateDiscovery', () => {
    it('shows "Let\'s find your work" CTA when discovery has never run', () => {
        render(<EmptyStateDiscovery plainTitle="All caught up" plainSubtitle="x" />)
        expect(screen.getByText(/let.?s find your work/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /discover my work/i })).toBeInTheDocument()
    })

    it('shows plain title when user already has tracked repos', () => {
        mockHook.repos = [{ repo_full_name: 'a/b', is_pinned: 0, is_muted: 0 }]
        mockHook.prefs = { last_discovery_at: '2026-04-22T10:00:00Z' }
        render(<EmptyStateDiscovery plainTitle="All caught up" plainSubtitle="Nothing urgent" />)
        expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
        expect(screen.queryByText(/let.?s find your work/i)).not.toBeInTheDocument()
    })

    it('Discover button triggers hook.discover + shows success toast', async () => {
        render(<EmptyStateDiscovery plainTitle="x" plainSubtitle="y" />)
        fireEvent.click(screen.getByRole('button', { name: /discover my work/i }))
        await waitFor(() => expect(mockHook.discover).toHaveBeenCalled())
        expect(mockToast.success).toHaveBeenCalled()
    })

    it('Discover button disabled while isRefreshing', () => {
        mockHook.isRefreshing = true
        render(<EmptyStateDiscovery plainTitle="x" plainSubtitle="y" />)
        expect(screen.getByRole('button', { name: /discover my work/i })).toBeDisabled()
    })
})
