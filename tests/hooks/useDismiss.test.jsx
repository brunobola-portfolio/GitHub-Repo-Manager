import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useDismiss } from '../../src/hooks/useDismiss'

function Harness({ open, onClose, escape }) {
    const panel = useRef(null)
    const trigger = useRef(null)
    useDismiss([panel, trigger], { open, onClose, escape })
    return (
        <div>
            <button ref={trigger} type="button">toggle</button>
            <div ref={panel} data-testid="panel"><span data-testid="inside">in</span></div>
            <p data-testid="outside">out</p>
        </div>
    )
}

describe('useDismiss', () => {
    it('closes on a press outside every ref, not on one inside any of them', () => {
        const onClose = vi.fn()
        const { getByTestId, getByText } = render(<Harness open onClose={onClose} />)
        fireEvent.mouseDown(getByTestId('inside'))
        fireEvent.mouseDown(getByText('toggle'))
        expect(onClose).not.toHaveBeenCalled()
        fireEvent.mouseDown(getByTestId('outside'))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('closes on Escape unless the caller owns Escape', () => {
        const onClose = vi.fn()
        const { rerender } = render(<Harness open onClose={onClose} />)
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onClose).toHaveBeenCalledTimes(1)
        rerender(<Harness open onClose={onClose} escape={false} />)
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('listens only while open', () => {
        const onClose = vi.fn()
        const { getByTestId } = render(<Harness open={false} onClose={onClose} />)
        fireEvent.mouseDown(getByTestId('outside'))
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onClose).not.toHaveBeenCalled()
    })

    it('calls the latest onClose without re-subscribing', () => {
        const first = vi.fn()
        const second = vi.fn()
        const { rerender, getByTestId } = render(<Harness open onClose={first} />)
        rerender(<Harness open onClose={second} />)
        fireEvent.mouseDown(getByTestId('outside'))
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)
    })
})
