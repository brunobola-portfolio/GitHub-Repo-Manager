/*
 * Slice 5 / row 13 audit follow-up — LicenseActivationModal had its
 * "Validate License" button rendered inline inside the modal body, so on
 * narrow viewports a long success/error block could push the action row
 * below the visible scroll area.
 *
 * Modal already provides a flex-shrink-0 footer slot via the `footer` prop;
 * the fix is to lift the action button into that slot rather than building
 * a new mobile primitive.
 *
 * This guard locks the contract so a future edit doesn't push the button
 * back into body content.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('LicenseActivationModal — sticky-footer contract (slice 5 row 13)', () => {
    const source = readFileSync('src/components/Settings/LicenseActivationModal.jsx', 'utf8')

    it('renders the action row via Modal.footer, not inline in body', () => {
        // Multiline match: Modal must receive a footer prop containing the
        // primary action button (Activate License).
        expect(source).toMatch(/footer=\{[\s\S]*Activate License[\s\S]*\}[\s\S]*>/m)
    })

    it('uses the ModalFooter primitive for consistent button-row spacing', () => {
        expect(source).toMatch(/<ModalFooter/)
    })
})
