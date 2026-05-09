import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { DiffCollapser, EXPANDED_STORAGE_KEY } from '@/components/PRReview/DiffPanel/DiffCollapser'

afterEach(() => {
    cleanup()
    localStorage.clear()
})

describe('DiffCollapser', () => {
    it('renders the placeholder + line count when collapsed', () => {
        render(
            <DiffCollapser
                filename="src/big.js"
                additions={1200}
                deletions={300}
                storageKey="pr:1"
            >
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        expect(screen.getByText(/1500 lines changed/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /show diff/i })).toBeInTheDocument()
        expect(screen.queryByTestId('full')).not.toBeInTheDocument()
    })

    it('renders children when the user clicks "Show diff"', () => {
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey="pr:1">
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        fireEvent.click(screen.getByRole('button', { name: /show diff/i }))
        expect(screen.getByTestId('full')).toBeInTheDocument()
    })

    it('persists the expanded set to localStorage and re-hydrates on mount', () => {
        const storageKey = 'pr:42'
        localStorage.setItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`, JSON.stringify(['src/big.js']))
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey={storageKey}>
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        expect(screen.getByTestId('full')).toBeInTheDocument()
    })

    it('writes the filename into localStorage when expanded by user', () => {
        const storageKey = 'pr:99'
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey={storageKey}>
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        fireEvent.click(screen.getByRole('button', { name: /show diff/i }))
        const stored = JSON.parse(localStorage.getItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`) || '[]')
        expect(stored).toContain('src/big.js')
    })

    it('responds to a global "expand-all" event', () => {
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey="pr:1">
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        expect(screen.queryByTestId('full')).not.toBeInTheDocument()
        act(() => {
            window.dispatchEvent(new CustomEvent('diff-collapser:expand-all'))
        })
        expect(screen.getByTestId('full')).toBeInTheDocument()
    })

    it('responds to a global "collapse-all" event', () => {
        const storageKey = 'pr:1'
        localStorage.setItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`, JSON.stringify(['src/big.js']))
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey={storageKey}>
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        expect(screen.getByTestId('full')).toBeInTheDocument()
        act(() => {
            window.dispatchEvent(new CustomEvent('diff-collapser:collapse-all'))
        })
        expect(screen.queryByTestId('full')).not.toBeInTheDocument()
    })
})
