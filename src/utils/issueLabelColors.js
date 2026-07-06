/**
 * Contrast-safe styling for GitHub issue-label chips.
 *
 * Labels arrive with an arbitrary user-chosen hex (e.g. a pale yellow like
 * `e4e669`). The historical chip painted the RAW label colour as the text on a
 * 12.5%-opacity tint of the same colour — which for light labels lands around
 * 1.3:1 and fails WCAG badly. GitHub's own labels solve this by DERIVING the
 * text colour from the label colour per theme: a darkened variant on the light
 * tint, a brightened variant on the dark tint. We do the same, deriving both so
 * the chip keeps its colour identity while clearing 4.5:1 in both themes.
 *
 * The tint background (`#RRGGBB20`) and border (`#RRGGBB40`) are alpha values,
 * so a single inline value composites correctly over the white card in light
 * mode AND the slate-900 card in dark mode — only the TEXT colour must differ
 * per theme, which we surface as CSS custom properties consumed by
 * `text-[color:var(--lbl-fg)] dark:text-[color:var(--lbl-fg-dark)]`.
 */

const AA_NORMAL = 4.5

function parseHex(color) {
    const h = String(color || '888888').replace(/^#/, '')
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6)
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

function toHex(rgb) {
    return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}

function channelLum(c) {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function luminance([r, g, b]) {
    return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b)
}

function contrast(a, b) {
    const la = luminance(a)
    const lb = luminance(b)
    const [hi, lo] = la > lb ? [la, lb] : [lb, la]
    return (hi + 0.05) / (lo + 0.05)
}

// Composite `rgb` at `alpha` over an opaque `base`.
function composite(rgb, alpha, base) {
    return rgb.map((c, i) => c * alpha + base[i] * (1 - alpha))
}

const WHITE = [255, 255, 255]
const SLATE_900 = [15, 23, 42]
const TINT_ALPHA = 0x20 / 255 // matches the `#RRGGBB20` background

// Darken the label colour toward black (hue preserved) until it reads on its
// own light tint at >= 4.5:1. Black on a near-white tint is ~19:1, so the loop
// always converges well before it bottoms out.
function textOnLight(rgb) {
    const bg = composite(rgb, TINT_ALPHA, WHITE)
    let fg = rgb
    for (let i = 0; i < 40 && contrast(fg, bg) < AA_NORMAL; i++) {
        fg = fg.map((c) => c * 0.92)
    }
    return toHex(fg)
}

// Brighten the label colour toward white until it reads on its own dark tint.
function textOnDark(rgb) {
    const bg = composite(rgb, TINT_ALPHA, SLATE_900)
    let fg = rgb
    for (let i = 0; i < 40 && contrast(fg, bg) < AA_NORMAL; i++) {
        fg = fg.map((c) => c + (255 - c) * 0.12)
    }
    return toHex(fg)
}

/**
 * Build the inline `style` object for an issue-label chip. Pair it with the
 * classes `text-[color:var(--lbl-fg)] dark:text-[color:var(--lbl-fg-dark)]`
 * (plus your own sizing/shape utilities) so the derived text colour applies.
 */
export function issueLabelChipStyle(color) {
    const hex = String(color || '888888').replace(/^#/, '')
    const rgb = parseHex(hex)
    return {
        backgroundColor: `#${hex}20`,
        borderColor: `#${hex}40`,
        borderWidth: 1,
        '--lbl-fg': textOnLight(rgb),
        '--lbl-fg-dark': textOnDark(rgb),
    }
}
