/*
 * "20+ bulk operations at your fingertips" was marketing arithmetic, not a
 * count of anything. The repository batch menu offers seven multi-select
 * actions and the Work Board bulk bar three — ten, not twenty-plus.
 *
 * The gate below does not pin an exact number, because the right number
 * changes whenever someone adds an action. It pins the property that actually
 * matters: the advertised figure may never exceed what ships. Understating is
 * fine; overstating is the defect.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

const featuresSource = read('src/components/Landing/FeaturesSection.jsx')
const contextMenuSource = read('src/components/RepoContextMenu.jsx')
const workBoardBarSource = read('src/components/Settings/WorkBoard/BulkActionsBar.jsx')

/** Multi-select actions in the repository batch menu, e.g. item('archive_selected'). */
function repoBatchActions() {
    const body = contextMenuSource.slice(contextMenuSource.indexOf('function buildBatchItems'))
    return [...new Set([...body.matchAll(/item\('([a-z_]+_selected)'\)/g)].map((m) => m[1]))]
}

/** Bulk actions on the Work Board selection bar, e.g. onAction('pin'). */
function workBoardActions() {
    return [...new Set([...workBoardBarSource.matchAll(/onAction\('([a-z_]+)'\)/g)].map((m) => m[1]))]
}

describe('FeaturesSection — the bulk-operations claim is not inflated', () => {
    const implemented = repoBatchActions().length + workBoardActions().length

    it('finds the actions at all (guards the scanner itself)', () => {
        expect(repoBatchActions().length).toBeGreaterThanOrEqual(5)
        expect(workBoardActions().length).toBeGreaterThanOrEqual(2)
    })

    it('never advertises more bulk operations than ship', () => {
        const claimed = [...featuresSource.matchAll(/(\d+)\+?\s*bulk operations/gi)].map((m) => Number(m[1]))
        expect(claimed.length, 'the claim moved or lost its number — re-point this gate').toBe(1)
        expect(
            claimed[0],
            `advertises ${claimed[0]} bulk operations against ${implemented} implemented`,
        ).toBeLessThanOrEqual(implemented)
    })
})
