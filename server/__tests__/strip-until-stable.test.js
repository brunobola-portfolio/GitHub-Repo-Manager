/*
 * A single `String.replace` guarantees nothing about its own output: what a
 * rule leaves behind can match that same rule again. This is the fixed point
 * that closes that, and the cap that stops the repetition from becoming its
 * own denial of service.
 */
import { describe, it, expect } from 'vitest'
import { stripUntilStable, MAX_PASSES } from '../lib/strip-until-stable.js'
import { sanitizeSvg } from '../lib/ai-features/diagram-embed.js'

const stripTags = (v) => v.replace(/<[^>]+>/g, '')
// The clearest shape of the problem: removing a substring can spell it again.
const stripWord = (v) => v.replace(/script/g, '')

describe('stripUntilStable', () => {
    it('returns clean input untouched, in one pass', () => {
        expect(stripUntilStable('plain text', stripTags)).toEqual({ ok: true, value: 'plain text' })
    })

    it('removes what a single pass reconstructs', () => {
        expect(stripWord('scrscriptipt'), 'one pass spells it again').toBe('script')
        expect(stripUntilStable('scrscriptipt', stripWord).value).toBe('')
    })

    it('is idempotent: running it again changes nothing', () => {
        const once = stripUntilStable('<b>bold</b> <i>x', stripTags).value
        expect(stripUntilStable(once, stripTags).value).toBe(once)
    })

    it('reports failure instead of returning a half-cleaned value', () => {
        // A rule that always changes its input never reaches a fixed point.
        const never = (v) => `${v}x`
        const result = stripUntilStable('a', never)
        expect(result.ok).toBe(false)
        expect(result.value).toBe('a' + 'x'.repeat(MAX_PASSES))
    })

    it('does not iterate without bound', () => {
        let calls = 0
        stripUntilStable('a', (v) => { calls += 1; return `${v}x` })
        // MAX_PASSES rounds, plus the one confirmation call that decides `ok`.
        expect(calls).toBe(MAX_PASSES + 1)
    })
})

describe('sanitizeSvg uses it as a boundary, not a best effort', () => {
    it('collapses a nested script rather than reassembling one', () => {
        const out = sanitizeSvg('<svg><scr<script>ipt>alert(1)</script></svg>')
        expect(out.ok).toBe(true)
        expect(out.svg).not.toMatch(/<script/i)
        expect(out.svg).not.toContain('alert(1)')
    })

    it('leaves no live comment terminator behind', () => {
        const out = sanitizeSvg('<svg><!--<!-- --><rect/>-->  <rect/></svg>')
        expect(out.ok).toBe(true)
        expect(out.svg).not.toContain('<!--')
    })

    it('still strips event handlers and passes clean art through', () => {
        expect(sanitizeSvg('<svg><rect onload="alert(1)"/></svg>').svg).not.toMatch(/onload/i)
        const clean = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>'
        expect(sanitizeSvg(clean).svg).toBe(clean)
    })
})
