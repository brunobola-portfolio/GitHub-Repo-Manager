import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { HeroSyncChip } = await import('../../../src/components/Dashboard/HeroSyncChip')

describe('HeroSyncChip', () => {
    it('calls onSync when clicked', async () => {
        const onSync = vi.fn().mockResolvedValue()
        render(<HeroSyncChip onSync={onSync} lastSyncedAt={null} />)
        fireEvent.click(screen.getByRole('button'))
        await waitFor(() => expect(onSync).toHaveBeenCalled())
    })

    it('renders "Sync" when no lastSyncedAt', () => {
        render(<HeroSyncChip onSync={() => {}} lastSyncedAt={null} />)
        expect(screen.getByText('Sync')).toBeInTheDocument()
    })
})
