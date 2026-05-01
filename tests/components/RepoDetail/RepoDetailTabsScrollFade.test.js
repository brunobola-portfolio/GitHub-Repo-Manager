/*
 * Slice 5 / row 8 — RepoDetail tab strip overflows horizontally on narrow
 * viewports (7 tabs × ~120px ≈ 840px). When the user can scroll horizontally
 * but there's no visual cue, mobile users miss tabs entirely.
 *
 * Fix: a CSS mask-image fade gradient at both horizontal edges of the
 * scroll container, signalling "more content this way" without taking
 * extra vertical space. This is a static regression guard — verifies the
 * fade pattern stays in place across future RepoDetail edits.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('RepoDetail — tab strip scroll fade indicator (slice 5 row 8)', () => {
    const source = readFileSync('src/components/RepoDetail/RepoDetail.jsx', 'utf8')

    it('TabBar wrapper applies a horizontal mask-image gradient', () => {
        // Tailwind arbitrary-value mask: fades the leftmost & rightmost ~24px
        // of the tab strip so users can see something is scrolling out of view.
        expect(source).toMatch(/mask-image:linear-gradient\(to_right,/)
    })

    it('TabBar wrapper retains overflow-x-auto so the strip is actually scrollable', () => {
        expect(source).toMatch(/overflow-x-auto/)
    })
})
