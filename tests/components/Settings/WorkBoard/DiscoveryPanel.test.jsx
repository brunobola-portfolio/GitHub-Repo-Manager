import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DiscoveryPanel } from '../../../../src/components/Settings/WorkBoard/DiscoveryPanel'

const defaultPrefs = {
    discovery_window_days: 60,
    max_auto_repos: 50,
    auto_mute_bots: 0,
    last_discovery_at: '2026-04-20T10:00:00Z',
}

describe('DiscoveryPanel', () => {
    it('renders last synced + counts', () => {
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={24}
                mutedCount={2}
                pinnedCount={3}
                isRefreshing={false}
                onRefresh={() => {}}
                onUpdatePrefs={() => {}}
            />
        )
        expect(screen.getByText(/24/)).toBeInTheDocument()
        expect(screen.getByText(/tracked/)).toBeInTheDocument()
        expect(screen.getByText(/2/)).toBeInTheDocument()
        expect(screen.getByText(/muted/)).toBeInTheDocument()
        expect(screen.getByText(/3/)).toBeInTheDocument()
        expect(screen.getByText(/pinned/)).toBeInTheDocument()
    })

    it('refresh button fires onRefresh', () => {
        const onRefresh = vi.fn()
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={0}
                mutedCount={0}
                pinnedCount={0}
                isRefreshing={false}
                onRefresh={onRefresh}
                onUpdatePrefs={() => {}}
            />
        )
        fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
        expect(onRefresh).toHaveBeenCalled()
    })

    it('window select change calls onUpdatePrefs with discovery_window_days', async () => {
        const onUpdatePrefs = vi.fn().mockResolvedValue({})
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={0}
                mutedCount={0}
                pinnedCount={0}
                isRefreshing={false}
                onRefresh={() => {}}
                onUpdatePrefs={onUpdatePrefs}
            />
        )
        const select = screen.getByLabelText(/activity window/i)
        fireEvent.change(select, { target: { value: '90' } })
        await waitFor(() => expect(onUpdatePrefs).toHaveBeenCalledWith({ discovery_window_days: 90 }))
    })

    it('auto-mute bots toggle calls onUpdatePrefs with auto_mute_bots', async () => {
        const onUpdatePrefs = vi.fn().mockResolvedValue({})
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={0}
                mutedCount={0}
                pinnedCount={0}
                isRefreshing={false}
                onRefresh={() => {}}
                onUpdatePrefs={onUpdatePrefs}
            />
        )
        fireEvent.click(screen.getByRole('switch', { name: /auto-mute bots/i }))
        await waitFor(() => expect(onUpdatePrefs).toHaveBeenCalledWith({ auto_mute_bots: 1 }))
    })

    it('refresh button disabled while isRefreshing', () => {
        render(
            <DiscoveryPanel
                prefs={defaultPrefs}
                totalCount={0}
                mutedCount={0}
                pinnedCount={0}
                isRefreshing
                onRefresh={() => {}}
                onUpdatePrefs={() => {}}
            />
        )
        expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled()
    })
})
