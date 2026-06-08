import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodeReviewToolbar } from '../../../src/components/diff/CodeReviewToolbar'
import { onAppEvent, APP_EVENTS } from '../../../src/utils/appEvents'

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

    it('exposes a tab-width selector with values 2 / 4 / 8', async () => {
        render(<CodeReviewToolbar {...BASE_PROPS} />)
        const trigger = screen.getByRole('combobox', { name: /tab width/i })
        expect(trigger).toBeInTheDocument()
        fireEvent.click(trigger)
        expect(await screen.findByRole('option', { name: 'tab 2' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'tab 4' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'tab 8' })).toBeInTheDocument()
    })

    it('selecting a tab width calls onSetTabWidth with the numeric value', async () => {
        const onSetTabWidth = vi.fn()
        render(<CodeReviewToolbar {...BASE_PROPS} onSetTabWidth={onSetTabWidth} />)
        fireEvent.click(screen.getByRole('combobox', { name: /tab width/i }))
        fireEvent.click(await screen.findByRole('option', { name: 'tab 8' }))
        expect(onSetTabWidth).toHaveBeenCalledWith(8)
    })
})

describe('CodeReviewToolbar — expand/collapse all', () => {
    it('dispatches diff-collapser:expand-all when "Expand all" is clicked', () => {
        const spy = vi.fn()
        const off = onAppEvent(APP_EVENTS.DIFF_EXPAND_ALL, spy)
        try {
            render(<CodeReviewToolbar {...BASE_PROPS} />)
            fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
            expect(spy).toHaveBeenCalledTimes(1)
        } finally {
            off()
        }
    })

    it('dispatches diff-collapser:collapse-all when "Collapse all" is clicked', () => {
        const spy = vi.fn()
        const off = onAppEvent(APP_EVENTS.DIFF_COLLAPSE_ALL, spy)
        try {
            render(<CodeReviewToolbar {...BASE_PROPS} />)
            fireEvent.click(screen.getByRole('button', { name: /collapse all/i }))
            expect(spy).toHaveBeenCalledTimes(1)
        } finally {
            off()
        }
    })
})
