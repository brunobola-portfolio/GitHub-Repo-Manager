/*
 * Slice 5 / row 12 — SettingsModal has up to 8 tabs (general / api-keys /
 * ai / ai-instructions / work-board / license / audit / probe-stats), which
 * overflows horizontally inside the modal frame on viewports < md. The
 * Modal primitive renders the tab strip via its own wrapper around <TabBar>,
 * so the fix is centralised: the wrapper must scroll horizontally and fade
 * at edges so users can see there's more content sideways.
 *
 * Generic fix benefits every modal with multi-tab content (CommunityHealth,
 * DevToolkit, etc.) without regressing modals that fit comfortably (the
 * overflow + mask are no-ops when content fits).
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('Modal tab strip — overflow + fade for narrow viewports (slice 5 row 12)', () => {
    const source = readFileSync('src/components/ui/Modal.jsx', 'utf8')

    it('the tab strip wrapper allows horizontal scrolling', () => {
        // Simple regex: the wrapper around <TabBar> includes overflow-x-auto.
        expect(source).toMatch(/overflow-x-auto/)
    })

    it('the tab strip wrapper applies a horizontal mask-image gradient at edges', () => {
        expect(source).toMatch(/mask-image:linear-gradient\(to_right,/)
    })
})
