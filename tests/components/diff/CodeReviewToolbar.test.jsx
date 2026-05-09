import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodeReviewToolbar } from '../../../src/components/diff/CodeReviewToolbar'

const BASE_PROPS = {
    filesCount: 3,
    additions: 42,
    deletions: 7,
    reviewedCount: 1,
    activeIndex: 0,
    treeCollapsed: false,
    onToggleTree: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    mode: 'unified',
    onToggleMode: vi.fn(),
    wrap: false,
    onToggleWrap: vi.fn(),
    tabWidth: 4,
    onSetTabWidth: vi.fn(),
    rightSlotPresent: true,
    rightCollapsed: false,
    onToggleRight: vi.fn(),
}

describe('CodeReviewToolbar', () => {
    it('shows files / additions / deletions counts', () => {
        render(<CodeReviewToolbar {...BASE_PROPS} />)
        expect(screen.getAllByText(/3/).length).toBeGreaterThan(0)
        expect(screen.getByText(/\+42/)).toBeInTheDocument()
        expect(screen.getByText(/−7/)).toBeInTheDocument()
    })

    it('clicking the mode button calls onToggleMode', () => {
        render(<CodeReviewToolbar {...BASE_PROPS} />)
        fireEvent.click(screen.getByRole('button', { name: /split|unified/i }))
        expect(BASE_PROPS.onToggleMode).toHaveBeenCalled()
    })

    it('hides the right-slot toggle when rightSlotPresent is false', () => {
        render(<CodeReviewToolbar {...BASE_PROPS} rightSlotPresent={false} />)
        expect(screen.queryByLabelText(/AI insights/i)).toBeNull()
    })

    it('exposes a tab-width selector with values 2 / 4 / 8', () => {
        render(<CodeReviewToolbar {...BASE_PROPS} />)
        const select = screen.getByLabelText(/tab width/i)
        expect(select).toBeInTheDocument()
        const options = [...select.querySelectorAll('option')].map(o => o.value)
        expect(options).toEqual(expect.arrayContaining(['2', '4', '8']))
    })
})
