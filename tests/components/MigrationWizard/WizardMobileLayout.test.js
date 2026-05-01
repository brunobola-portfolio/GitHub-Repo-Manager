/*
 * Slice 5 / row 14 — MigrationWizard responsive sweep.
 *
 * Audit at 375×667 (iPhone SE) found 4 layout offenders that overflow or
 * squeeze on narrow viewports. This guard locks in the fixes so they don't
 * regress in future wizard edits.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('MigrationWizard — mobile responsive layout (slice 5 row 14)', () => {
    it('RepoConfigStep stats grid drops from 4 to 2 columns at < sm', () => {
        const source = readFileSync('src/components/MigrationWizard/steps/RepoConfigStep.jsx', 'utf8')
        // The stats row was grid-cols-4; needs grid-cols-2 sm:grid-cols-4.
        expect(source).toMatch(/grid-cols-2\s+sm:grid-cols-4/)
    })

    it('RepoConfigStep header stacks the destination + bulk-actions row on mobile', () => {
        const source = readFileSync('src/components/MigrationWizard/steps/RepoConfigStep.jsx', 'utf8')
        // Header row was a single flex with justify-between; needs flex-col → sm:flex-row.
        expect(source).toMatch(/flex-col\s+sm:flex-row/)
    })

    it('ProgressStep right-side status cluster wraps so the retry button never overflows', () => {
        const source = readFileSync('src/components/MigrationWizard/steps/ProgressStep.jsx', 'utf8')
        // The "Right side: status badge + elapsed + retry" cluster must allow wrap.
        const block = source.match(/Right side: status badge[\s\S]{0,300}/)?.[0] ?? ''
        expect(block, 'right-side cluster comment block').not.toEqual('')
        expect(block).toMatch(/flex-wrap/)
    })

    it('BreadcrumbNav allows horizontal scroll if org/project names are long', () => {
        const source = readFileSync('src/components/MigrationWizard/BreadcrumbNav.jsx', 'utf8')
        expect(source).toMatch(/overflow-x-auto/)
    })
})
