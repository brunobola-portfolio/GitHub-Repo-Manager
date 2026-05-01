/*
 * Slice 5 / row 4 — At < sm (375px) the pie chart's 280px square crowds out
 * the language legend, leaving labels truncated and percentages unreadable.
 * Replace it with a horizontal stacked bar (GitHub-style language bar) on
 * narrow viewports while keeping the pie variant on sm+.
 *
 * This guard locks in the responsive contract: both variants must coexist
 * in source so neither gets accidentally deleted when the other is edited.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('LanguageChart — compact bar variant on narrow viewports (slice 5 row 4)', () => {
    const source = readFileSync('src/components/Dashboard/LanguageChart.jsx', 'utf8')

    it('renders a horizontal stacked bar marked for sub-sm viewports only', () => {
        // The bar variant must hide at sm+ (where the pie takes over).
        expect(source).toMatch(/sm:hidden/)
    })

    it('keeps the pie chart hidden below sm so it never crowds the legend', () => {
        // Pie variant is only shown at sm+.
        expect(source).toMatch(/hidden\s+sm:/)
    })

    it('exposes a data-testid so callers can target either variant in tests', () => {
        expect(source).toMatch(/data-testid="language-chart-bar"/)
        expect(source).toMatch(/data-testid="language-chart-pie"/)
    })
})
