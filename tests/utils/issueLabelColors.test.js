import { describe, it, expect } from 'vitest'
import { issueLabelChipStyle } from '../../src/utils/issueLabelColors'

// Local WCAG contrast helpers (kept independent of the implementation so the
// test verifies the *guarantee*, not the same maths).
function chan(c) {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
function lum([r, g, b]) {
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}
function ratio(a, b) {
    const la = lum(a)
    const lb = lum(b)
    const [hi, lo] = la > lb ? [la, lb] : [lb, la]
    return (hi + 0.05) / (lo + 0.05)
}
function hexToRgb(hex) {
    const h = hex.replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function composite(rgb, alpha, base) {
    return rgb.map((c, i) => c * alpha + base[i] * (1 - alpha))
}

const WHITE = [255, 255, 255]
const SLATE_900 = [15, 23, 42]
const TINT = 0x20 / 255

// A spread of real GitHub label colours, including the pathological pale ones
// (yellow / cyan) whose raw value fails ~1.3:1 on their own tint.
const LABEL_COLORS = ['e4e669', 'a2eeef', '7057ff', 'd876e3', '0e8a16', 'b60205', 'ffffff', '000000', 'cccccc']

describe('issueLabelChipStyle', () => {
    it('derives light-mode text that clears AA (4.5:1) on the label tint', () => {
        for (const color of LABEL_COLORS) {
            const style = issueLabelChipStyle(color)
            const bg = composite(hexToRgb(color), TINT, WHITE)
            const fg = hexToRgb(style['--lbl-fg'])
            expect(ratio(fg, bg), `light ${color}`).toBeGreaterThanOrEqual(4.5)
        }
    })

    it('derives dark-mode text that clears AA (4.5:1) on the label tint', () => {
        for (const color of LABEL_COLORS) {
            const style = issueLabelChipStyle(color)
            const bg = composite(hexToRgb(color), TINT, SLATE_900)
            const fg = hexToRgb(style['--lbl-fg-dark'])
            expect(ratio(fg, bg), `dark ${color}`).toBeGreaterThanOrEqual(4.5)
        }
    })

    it('keeps the tint background + border alpha values verbatim', () => {
        const style = issueLabelChipStyle('7057ff')
        expect(style.backgroundColor).toBe('#7057ff20')
        expect(style.borderColor).toBe('#7057ff40')
    })

    it('tolerates a missing/short colour without throwing', () => {
        expect(() => issueLabelChipStyle(undefined)).not.toThrow()
        expect(() => issueLabelChipStyle('abc')).not.toThrow()
    })
})
