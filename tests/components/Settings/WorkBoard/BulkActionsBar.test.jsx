import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkActionsBar } from '../../../../src/components/Settings/WorkBoard/BulkActionsBar'

describe('BulkActionsBar', () => {
    it('renders nothing when selectedCount is 0', () => {
        const { container } = render(
            <BulkActionsBar selectedCount={0} onAction={() => {}} onClear={() => {}} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('shows count and action buttons when selectedCount > 0', () => {
        render(<BulkActionsBar selectedCount={3} onAction={() => {}} onClear={() => {}} />)
        expect(screen.getByText(/3 selected/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /pin/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    })

    it('fires onAction("pin") when Pin clicked', () => {
        const onAction = vi.fn()
        render(<BulkActionsBar selectedCount={3} onAction={onAction} onClear={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /^pin$/i }))
        expect(onAction).toHaveBeenCalledWith('pin')
    })

    it('fires onClear when Clear clicked', () => {
        const onClear = vi.fn()
        render(<BulkActionsBar selectedCount={3} onAction={() => {}} onClear={onClear} />)
        fireEvent.click(screen.getByRole('button', { name: /clear selection/i }))
        expect(onClear).toHaveBeenCalled()
    })
})
