import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DangerZoneCard } from '../../../../src/components/Settings/WorkBoard/DangerZoneCard'

describe('DangerZoneCard', () => {
    it('renders two danger actions', () => {
        render(<DangerZoneCard onResetDiscovery={() => {}} onClearAll={() => {}} />)
        expect(screen.getByRole('button', { name: /reset discovery/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /clear all data/i })).toBeInTheDocument()
    })

    it('clicking Reset opens confirm modal', async () => {
        render(<DangerZoneCard onResetDiscovery={() => {}} onClearAll={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /reset discovery/i }))
        expect(await screen.findByText(/reset discovery\?/i)).toBeInTheDocument()
    })

    it('confirming Reset calls onResetDiscovery', async () => {
        const onResetDiscovery = vi.fn().mockResolvedValue()
        render(<DangerZoneCard onResetDiscovery={onResetDiscovery} onClearAll={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /reset discovery/i }))
        fireEvent.click(await screen.findByRole('button', { name: /^reset$/i }))
        expect(onResetDiscovery).toHaveBeenCalled()
    })

    it('confirming Clear calls onClearAll', async () => {
        const onClearAll = vi.fn().mockResolvedValue()
        render(<DangerZoneCard onResetDiscovery={() => {}} onClearAll={onClearAll} />)
        fireEvent.click(screen.getByRole('button', { name: /clear all data/i }))
        fireEvent.click(await screen.findByRole('button', { name: /^clear everything$/i }))
        expect(onClearAll).toHaveBeenCalled()
    })
})
