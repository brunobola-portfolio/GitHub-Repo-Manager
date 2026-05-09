import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DiffComputeOnDemand } from '@/components/PRReview/DiffPanel/DiffComputeOnDemand'

afterEach(() => cleanup())

describe('DiffComputeOnDemand', () => {
    it('renders a placeholder with the file path and line count', () => {
        render(
            <DiffComputeOnDemand filename="src/huge.lock" additions={120_000} deletions={0}>
                <div data-testid="real-diff">REAL DIFF</div>
            </DiffComputeOnDemand>,
        )
        expect(screen.getByText(/src\/huge\.lock/)).toBeInTheDocument()
        expect(screen.getByText(/120000 lines changed/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /compute diff/i })).toBeInTheDocument()
        expect(screen.queryByTestId('real-diff')).not.toBeInTheDocument()
    })

    it('mounts children only after the user clicks "Compute diff"', () => {
        render(
            <DiffComputeOnDemand filename="src/huge.lock" additions={120_000} deletions={0}>
                <div data-testid="real-diff">REAL DIFF</div>
            </DiffComputeOnDemand>,
        )
        fireEvent.click(screen.getByRole('button', { name: /compute diff/i }))
        expect(screen.getByTestId('real-diff')).toBeInTheDocument()
    })

    it('shows a warning about expected slow first paint', () => {
        render(
            <DiffComputeOnDemand filename="src/huge.lock" additions={120_000} deletions={0}>
                <div data-testid="real-diff">REAL DIFF</div>
            </DiffComputeOnDemand>,
        )
        expect(screen.getByText(/may take a moment to render|slow/i)).toBeInTheDocument()
    })
})
