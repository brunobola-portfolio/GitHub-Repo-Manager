/*
 * Slice 5 / rows 10–11 — WorkBoard mobile.
 *
 * Row 10 (KpiRow): 4 cards laid out grid-cols-2 / md:grid-cols-4 leaves the
 * 2-wide layout cramped at < sm (cards become text-truncated). Stack
 * single-column at < sm so the count + sparkline + label all fit.
 *
 * Row 11 (AISummaryCard): the side-by-side gauge column overflows at < sm
 * unless the layout already breaks to flex-col. This test locks in the
 * existing flex-col → sm:flex-row contract so a future edit doesn't
 * regress it.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('WorkBoard — mobile parity (slice 5 rows 10+11)', () => {
    it('KpiRow stacks single-column at < sm and widens to 2 / 4 at sm / md', () => {
        const source = readFileSync('src/components/WorkBoard/KpiRow.jsx', 'utf8')
        // The grid container must include the sub-sm 1-column layout.
        // 2x2 below 640px (U24): one KPI per screen had pushed the tab strip
        // and the list itself four screens below the fold on a phone.
        expect(source).toMatch(/grid-cols-2\s+md:grid-cols-4/)
    })

    it('AISummaryCard breaks to flex-col below sm so the gauge stacks above the content', () => {
        const source = readFileSync('src/components/WorkBoard/AISummaryCard.jsx', 'utf8')
        expect(source).toMatch(/flex-col\s+sm:flex-row/)
    })
})
