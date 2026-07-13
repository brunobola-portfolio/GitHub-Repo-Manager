/*
 * Chrome uniformity (audit task 11b): the per-file table had no overflow
 * container inside its fixed ~320px column, unlike every other table in the
 * app (AuditLogSection, DLQTable). Long file paths would blow out the
 * column instead of scrolling. This locks in the overflow-x-auto wrapper.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// mermaid is lazy-loaded via dynamic import and irrelevant to the table
// assertions here — no walkthrough.mermaid is provided in these fixtures,
// so the import branch never fires.
vi.mock('../../../../src/utils/sanitizeSvg', () => ({ parseAndSanitizeSvg: vi.fn() }))

import { WalkthroughTab } from '@/components/PRReview/AIDeepReview/WalkthroughTab'

const WALKTHROUGH = {
    riskLevel: 'medium',
    estimatedReviewTime: '5 min',
    summary: 'Summary text',
    perFileTable: [
        { path: 'src/very/long/deeply/nested/path/that/should/not/wrap/or/blow/out/the/column/component.jsx', change: 'modified', summary: 'Refactor' },
        { path: 'src/index.js', change: 'added', summary: 'New entry' },
    ],
}

describe('WalkthroughTab — file table overflow handling', () => {
    it('wraps the per-file table in an overflow-x-auto container', () => {
        render(<WalkthroughTab walkthrough={WALKTHROUGH} />)
        const table = screen.getByText('File').closest('table')
        const wrapper = table.parentElement
        expect(wrapper.className).toContain('overflow-x-auto')
    })

    it('still renders every row (behavior unchanged)', () => {
        render(<WalkthroughTab walkthrough={WALKTHROUGH} />)
        expect(screen.getByText('src/index.js')).toBeInTheDocument()
        expect(screen.getByText(/component\.jsx/)).toBeInTheDocument()
    })
})
